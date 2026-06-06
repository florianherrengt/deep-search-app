import { useState } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckCircleIcon } from "lucide-react";
import { Button, Text, Box, TextInput } from "@mantine/core";
import { z } from "zod";
import { questionsInputSchema } from "@/tools/questions-tool";

type QuestionArgs = z.infer<typeof questionsInputSchema>;

type QuestionResult = {
  answers: {
    question: string;
    answer: string;
    custom?: boolean;
  }[];
};

export const QuestionsToolUI = makeAssistantToolUI<QuestionArgs, QuestionResult>({
  toolName: "ask_questions",
  render: ({ args, addResult, result }) => {
    if (result && typeof result === "object" && "answers" in result)
      return <CompletedView result={result as QuestionResult} />;
    const parsed = questionsInputSchema.safeParse(args);
    if (!parsed.success) return null;
    return <PendingView questions={parsed.data.questions} onSubmit={addResult} />;
  },
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

  const hasAny =
    Object.keys(selections).length > 0 ||
    Object.keys(customAnswers).length > 0;

  return (
    <Box my="sm" p="md" className="md-surface" style={{ borderRadius: 8, border: "1px solid" }}>
      {questions.map((q: QuestionArgs["questions"][number], qi: number) => (
        <Box key={qi} mb="md">
          <Text size="sm" fw={500} mb="xs">{q.question}</Text>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {q.candidates.map((c: { label: string; value: string }) => (
              <Button
                key={c.value}
                size="xs"
                variant={selections[qi] === c.value ? "filled" : "outline"}
                onClick={() => handleSelect(qi, c.value)}
                radius="md"
              >
                {c.label}
              </Button>
            ))}
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
      >
        Submit Answers
      </Button>
    </Box>
  );
}

function CompletedView({ result }: { result: QuestionResult }) {
  return (
    <Box my="sm" p="sm" style={{ borderRadius: 8, border: "1px solid var(--mantine-color-teal-3)", backgroundColor: "var(--mantine-color-teal-0)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <CheckCircleIcon style={{ width: 16, height: 16, color: "var(--mantine-color-teal-6)" }} />
        <Text size="sm" fw={500} c="teal.7">Answers submitted</Text>
      </div>
      {result.answers.map((a, i) => (
        <Text key={i} size="sm" c="gray.7">
          <span style={{ fontWeight: 500 }}>{a.question}</span>
          <span style={{ margin: "0 4px" }}>&rarr;</span>
          <span style={a.custom ? { fontStyle: "italic" } : undefined}>{a.answer}</span>
          {a.custom && (
            <Text component="span" size="xs" c="dimmed" ml={4}>(custom)</Text>
          )}
        </Text>
      ))}
    </Box>
  );
}
