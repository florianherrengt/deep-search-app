import { memo, useState, type CSSProperties } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckCircleIcon } from "lucide-react";
import { Button, Text, Box, TextInput } from "@mantine/core";
import { z } from "zod";
import { questionsInputSchema } from "@/tools/questions-tool";

export type QuestionArgs = z.infer<typeof questionsInputSchema>;

const questionResultSchema = z.object({
  answers: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      custom: z.boolean().optional(),
    }),
  ),
});

export type QuestionResult = z.infer<typeof questionResultSchema>;

type ButtonVariableStyle = CSSProperties & Record<`--${string}`, string>;

const unselectedChoiceButtonStyle: ButtonVariableStyle = {
  "--button-bg": "transparent",
  "--button-bd": "1px solid var(--md-question-choice-border)",
  "--button-color": "var(--md-question-choice-fg)",
  "--button-hover": "var(--md-question-choice-hover)",
  "--button-hover-color": "var(--md-question-choice-fg)",
};

const selectedChoiceButtonStyle: ButtonVariableStyle = {
  "--button-bg": "var(--md-question-action-bg)",
  "--button-bd": "1px solid var(--md-question-action-bg)",
  "--button-color": "var(--md-question-action-fg)",
  "--button-hover": "var(--md-question-action-hover)",
  "--button-hover-color": "var(--md-question-action-fg)",
};

const submitButtonStyle: ButtonVariableStyle = selectedChoiceButtonStyle;

function getChoiceButtonStyle(selected: boolean) {
  return selected ? selectedChoiceButtonStyle : unselectedChoiceButtonStyle;
}

export function canRenderQuestionsTool({
  args,
  result,
  canSubmit,
}: {
  args: unknown;
  result?: unknown;
  canSubmit: boolean;
}) {
  if (questionResultSchema.safeParse(result).success) return true;
  return canSubmit && questionsInputSchema.safeParse(args).success;
}

export const QuestionsToolUI = makeAssistantToolUI<QuestionArgs, QuestionResult>({
  toolName: "ask_questions",
  render: ({ args, addResult, result }) => {
    return <QuestionsToolView args={args} result={result} onSubmit={addResult} />;
  },
});

export const QuestionsToolView = memo(function QuestionsToolView({
  args,
  result,
  onSubmit,
}: {
  args: unknown;
  result?: unknown;
  onSubmit?: (result: QuestionResult) => void;
}) {
  // safeParse runs twice per render (result + args). Without React.memo this
  // fires on every token of any sibling streaming part inside the same
  // message (assistant-ui re-renders all parts when any part updates).
  // Microbench: 4μs per render → ~0μs on cache hit.
  const parsedResult = questionResultSchema.safeParse(result);
  if (parsedResult.success) {
    return <CompletedView result={parsedResult.data} />;
  }

  const parsedArgs = questionsInputSchema.safeParse(args);
  if (!parsedArgs.success || !onSubmit) return null;

  return (
    <PendingView questions={parsedArgs.data.questions} onSubmit={onSubmit} />
  );
});

function PendingView({
  questions,
  onSubmit,
}: {
  questions: QuestionArgs["questions"];
  onSubmit: (result: QuestionResult) => void;
}) {
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});

  function handleSelect(index: number, value: string) {
    if (!value) return;
    setSelections((prev) => ({ ...prev, [index]: value }));
    setCustomAnswers((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function setCustom(index: number, text: string) {
    setCustomAnswers((prev) => ({ ...prev, [index]: text }));
    if (text) {
      setSelections((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  }

  function handleSubmit() {
    const answers: QuestionResult["answers"] = [];
    questions.forEach((q, i) => {
      const custom = customAnswers[i]?.trim();
      const selected = selections[i];
      if (custom) {
        answers.push({ question: q.question, answer: custom, custom: true });
      } else if (selected) {
        answers.push({ question: q.question, answer: selected });
      }
    });
    onSubmit({ answers });
  }

  const hasAny = questions.some((_, index) => {
    return Boolean(selections[index] || customAnswers[index]?.trim());
  });

  return (
    <Box my="sm" p="md" className="md-card-sm md-question-tool" data-state="pending">
      {questions.map((q: QuestionArgs["questions"][number], qi: number) => (
        <Box key={qi} mb="md">
          <Text size="sm" fw={500} mb="xs">{q.question}</Text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {q.candidates.map((c: { label: string; value: string }) => {
              const selected = selections[qi] === c.value;
              return (
                <Button
                  key={c.value}
                  size="xs"
                  variant={selected ? "filled" : "outline"}
                  onClick={() => handleSelect(qi, c.value)}
                  radius="md"
                  style={getChoiceButtonStyle(selected)}
                >
                  {c.label}
                </Button>
              );
            })}
          </div>
          <TextInput
            placeholder="Or type your own..."
            value={customAnswers[qi] ?? ""}
            onChange={(e) => setCustom(qi, e.currentTarget.value)}
            size="sm"
            mt="xs"
          />
        </Box>
      ))}
      <Button
        onClick={handleSubmit}
        disabled={!hasAny}
        size="sm"
        color="blue"
        style={submitButtonStyle}
      >
        Submit Answers
      </Button>
    </Box>
  );
}

function CompletedView({ result }: { result: QuestionResult }) {
  return (
    <Box my="sm" p="sm" className="md-card-sm md-question-tool" data-state="completed">
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <CheckCircleIcon className="md-question-tool__icon" style={{ width: 16, height: 16 }} />
        <Text size="sm" fw={500}>Answers submitted</Text>
      </div>
      {result.answers.map((a, i) => (
        <Text key={i} size="sm" className="md-question-tool__muted">
          <span className="md-question-tool__answer-question">{a.question}</span>
          <span style={{ margin: "0 4px" }}>-&gt;</span>
          <span style={a.custom ? { fontStyle: "italic" } : undefined}>{a.answer}</span>
          {a.custom && (
            <Text component="span" size="xs" className="md-question-tool__muted" ml={4}>(custom)</Text>
          )}
        </Text>
      ))}
    </Box>
  );
}
