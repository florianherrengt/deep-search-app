const DEFAULT_CHUNK_TOKENS: usize = 512;
const OVERLAP_RATIO: f32 = 0.15;
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

struct Section {
    content: String,
    header_path: Option<String>,
}

fn split_by_headers(content: &str) -> Vec<Section> {
    let mut sections = Vec::new();
    let mut current_lines: Vec<String> = Vec::new();
    let mut current_header = String::new();
    let mut in_code_block = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            current_lines.push(line.to_string());
            continue;
        }

        if !in_code_block && (trimmed.starts_with("## ") || trimmed.starts_with("### ")) {
            if !current_lines.is_empty() {
                let text = current_lines.join("\n");
                if !text.trim().is_empty() {
                    sections.push(Section {
                        content: text,
                        header_path: if current_header.is_empty() {
                            None
                        } else {
                            Some(current_header.clone())
                        },
                    });
                }
                current_lines.clear();
            }

            let heading = trimmed.trim_start_matches('#').trim();
            if current_header.is_empty() {
                current_header = heading.to_string();
            } else {
                current_header = format!("{} > {}", current_header, heading);
            }
            current_lines.push(line.to_string());
            continue;
        }

        current_lines.push(line.to_string());
    }

    if !current_lines.is_empty() {
        let text = current_lines.join("\n");
        if !text.trim().is_empty() {
            sections.push(Section {
                content: text,
                header_path: if current_header.is_empty() {
                    None
                } else {
                    Some(current_header.clone())
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
