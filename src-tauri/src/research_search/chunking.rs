use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};

const DEFAULT_CHUNK_TOKENS: usize = 512;
const OVERLAP_RATIO: f32 = 0.20;
const MIN_CHARS_PER_TOKEN: usize = 3;

#[derive(Debug, Clone)]
pub struct Chunk {
    pub content: String,
    pub header_path: Option<String>,
    pub index: usize,
}

pub fn chunk_markdown(content: &str) -> Vec<Chunk> {
    let approx_chars = DEFAULT_CHUNK_TOKENS * MIN_CHARS_PER_TOKEN;
    let overlap_chars = (approx_chars as f32 * OVERLAP_RATIO) as usize;

    let sections = split_by_headers(content);

    let mut chunks = Vec::new();
    let mut current_buf = String::new();
    let mut current_header = String::new();
    let mut chunk_index = 0;

    for section in sections {
        if current_buf.len() + section.content.len() > approx_chars && !current_buf.is_empty() {
            push_chunk(&mut chunks, &current_buf, &current_header, chunk_index);
            chunk_index += 1;

            if overlap_chars > 0 && current_buf.len() > overlap_chars {
                let start = current_buf.len().saturating_sub(overlap_chars);
                current_buf = current_buf[start..].to_string();
            } else {
                current_buf.clear();
            }
        }

        if section.header_path.is_some() {
            current_header = section.header_path.clone().unwrap_or_default();
        }

        if !current_buf.is_empty() {
            current_buf.push('\n');
        }
        current_buf.push_str(&section.content);
    }

    if !current_buf.trim().is_empty() {
        push_chunk(&mut chunks, &current_buf, &current_header, chunk_index);
    }

    chunks
}

fn push_chunk(chunks: &mut Vec<Chunk>, content: &str, header_path: &str, index: usize) {
    let enriched = if header_path.is_empty() {
        content.to_string()
    } else {
        format!("{}\n\n{}", header_path, content)
    };
    chunks.push(Chunk {
        content: enriched,
        header_path: if header_path.is_empty() {
            None
        } else {
            Some(header_path.to_string())
        },
        index,
    });
}

#[derive(Debug, Clone)]
struct Section {
    content: String,
    header_path: Option<String>,
}

fn split_by_headers(content: &str) -> Vec<Section> {
    let options = Options::empty();
    let parser = Parser::new_ext(content, options);

    #[derive(Debug)]
    struct HeadingInfo {
        byte_start: usize,
        text: String,
    }

    let mut headings: Vec<HeadingInfo> = Vec::new();
    let mut in_heading_h2_h3 = false;
    let mut heading_byte_start = 0usize;
    let mut heading_text = String::new();

    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level, id: None, .. })
                if level == HeadingLevel::H2 || level == HeadingLevel::H3 =>
            {
                in_heading_h2_h3 = true;
                heading_byte_start = range.start;
                heading_text.clear();
            }
            Event::Text(text) if in_heading_h2_h3 => {
                heading_text.push_str(&text);
            }
            Event::End(TagEnd::Heading(level))
                if level == HeadingLevel::H2 || level == HeadingLevel::H3 =>
            {
                headings.push(HeadingInfo {
                    byte_start: heading_byte_start,
                    text: std::mem::take(&mut heading_text),
                });
                in_heading_h2_h3 = false;
            }
            _ => {}
        }
    }

    if headings.is_empty() {
        return vec![Section {
            content: content.to_string(),
            header_path: None,
        }];
    }

    let mut sections = Vec::new();
    let mut current_header = String::new();
    let mut prev_start = 0usize;

    for h in &headings {
        if h.byte_start > prev_start {
            let section_text = content[prev_start..h.byte_start].to_string();
            if !section_text.trim().is_empty() {
                sections.push(Section {
                    content: section_text,
                    header_path: if current_header.is_empty() {
                        None
                    } else {
                        Some(current_header.clone())
                    },
                });
            }
        }

        if current_header.is_empty() {
            current_header = h.text.clone();
        } else {
            current_header = format!("{} > {}", current_header, h.text);
        }

        prev_start = h.byte_start;
    }

    if prev_start < content.len() {
        let section_text = content[prev_start..].to_string();
        if !section_text.trim().is_empty() {
            sections.push(Section {
                content: section_text,
                header_path: if current_header.is_empty() {
                    None
                } else {
                    Some(current_header)
                },
            });
        }
    }

    if sections.is_empty() {
        sections.push(Section {
            content: content.to_string(),
            header_path: None,
        });
    }

    sections
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sections(content: &str) -> Vec<(String, Option<String>)> {
        split_by_headers(content)
            .into_iter()
            .map(|s| (s.content, s.header_path))
            .collect()
    }

    #[test]
    fn parse_empty_returns_empty() {
        let result = split_by_headers("");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].content, "");
        assert_eq!(result[0].header_path, None);
    }

    #[test]
    fn parse_whitespace_only_returns_single_empty_section() {
        let result = split_by_headers("   \n  \n  ");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].content, "   \n  \n  ");
        assert_eq!(result[0].header_path, None);
    }

    #[test]
    fn parse_plain_text_returns_one_section_no_header() {
        let result = sections("Hello world");
        assert_eq!(
            result,
            vec![("Hello world".to_string(), None)]
        );
    }

    #[test]
    fn parse_single_h2_section() {
        let result = sections("## Intro\nSome content here.");
        assert_eq!(
            result,
            vec![("## Intro\nSome content here.".to_string(), Some("Intro".to_string()))]
        );
    }

    #[test]
    fn parse_single_h3_section() {
        let result = sections("### Details\nMore content.");
        assert_eq!(
            result,
            vec![("### Details\nMore content.".to_string(), Some("Details".to_string()))]
        );
    }

    #[test]
    fn parse_h2_then_h3_builds_path() {
        let result = sections("## H1\nText\n### H2\nMore");
        assert_eq!(
            result,
            vec![
                ("## H1\nText\n".to_string(), Some("H1".to_string())),
                ("### H2\nMore".to_string(), Some("H1 > H2".to_string())),
            ]
        );
    }

    #[test]
    fn parse_h1_ignored_matches_original() {
        let result = sections("# H1\n## H2\nText");
        assert_eq!(
            result,
            vec![
                ("# H1\n".to_string(), None),
                ("## H2\nText".to_string(), Some("H2".to_string())),
            ]
        );
    }

    #[test]
    fn parse_h4_ignored_matches_original() {
        let result = sections("## Top\n#### Not a section break\nMore text");
        assert_eq!(
            result,
            vec![("## Top\n#### Not a section break\nMore text".to_string(), Some("Top".to_string()))]
        );
    }

    #[test]
    fn parse_code_block_stays_in_section() {
        let result = sections("## Section\n```\ncode here\n```\nmore");
        assert_eq!(
            result,
            vec![("## Section\n```\ncode here\n```\nmore".to_string(), Some("Section".to_string()))]
        );
    }

    #[test]
    fn parse_code_block_preserves_heading_like_lines() {
        let result = sections("## Real\n```\n## Not a heading\n### Also not\n```\nafter");
        assert_eq!(
            result,
            vec![(
                "## Real\n```\n## Not a heading\n### Also not\n```\nafter".to_string(),
                Some("Real".to_string())
            )]
        );
    }

    #[test]
    fn parse_two_h2_appends_to_header_path() {
        let result = sections("## A\n## B");
        assert_eq!(
            result,
            vec![
                ("## A\n".to_string(), Some("A".to_string())),
                ("## B".to_string(), Some("A > B".to_string())),
            ]
        );
    }

    #[test]
    fn parse_h2_h3_h2_builds_path() {
        let result = sections("## A\ncontent A\n### B\ncontent B\n## C\ncontent C");
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].1, Some("A".to_string()));
        assert_eq!(result[1].1, Some("A > B".to_string()));
        assert_eq!(result[2].1, Some("A > B > C".to_string()));
    }

    #[test]
    fn chunk_markdown_produces_chunks_with_headers() {
        let chunks = chunk_markdown("## Summary\nThis is a summary paragraph.");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].header_path.as_deref(), Some("Summary"));
        assert_eq!(chunks[0].index, 0);
    }

    #[test]
    fn chunk_markdown_empty_returns_no_chunks() {
        let chunks = chunk_markdown("");
        assert!(chunks.is_empty());

        let chunks = chunk_markdown("   \n  \n  ");
        assert!(chunks.is_empty());
    }

    #[test]
    fn chunk_markdown_large_no_headers_produces_single_oversized_chunk() {
        let long_line = "a".repeat(60);
        let mut content = String::new();
        for _ in 0..40 {
            content.push_str(&long_line);
            content.push('\n');
        }
        assert!(content.len() > 2000);

        let chunks = chunk_markdown(&content);
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].content.len() >= content.len());
    }

    #[test]
    fn parse_deep_nesting_header_path_grows_correctly() {
        let result = sections(
            "## Level 1\na\n### Level 2\nb\n## Level 3\nc\n### Level 4\nd\n## Level 5\ne\n### Level 6\nf\n## Level 7\ng",
        );
        assert_eq!(result.len(), 7);
        assert_eq!(result[0].1, Some("Level 1".to_string()));
        assert_eq!(result[1].1, Some("Level 1 > Level 2".to_string()));
        assert_eq!(result[2].1, Some("Level 1 > Level 2 > Level 3".to_string()));
        assert_eq!(result[3].1, Some("Level 1 > Level 2 > Level 3 > Level 4".to_string()));
        assert_eq!(result[4].1, Some("Level 1 > Level 2 > Level 3 > Level 4 > Level 5".to_string()));
        assert_eq!(result[5].1, Some("Level 1 > Level 2 > Level 3 > Level 4 > Level 5 > Level 6".to_string()));
        assert_eq!(result[6].1, Some("Level 1 > Level 2 > Level 3 > Level 4 > Level 5 > Level 6 > Level 7".to_string()));
    }

    #[test]
    fn parse_very_short_sections_between_many_headers() {
        let result = sections("## A\nx\n## B\ny\n## C\nz\n## D\nw");
        assert_eq!(result.len(), 4);
        assert_eq!(result[0].1, Some("A".to_string()));
        assert_eq!(result[1].1, Some("A > B".to_string()));
        assert_eq!(result[2].1, Some("A > B > C".to_string()));
        assert_eq!(result[3].1, Some("A > B > C > D".to_string()));
        for section in &result {
            assert!(!section.0.trim().is_empty());
        }
    }
}
