import { useState } from "react";
import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type QuestionArgs = {
  questions: {
    question: string;
    candidates: { label: string; value: string }[];
  }[];
};

type QuestionResult = {
  answers: {
    question: string;
    answer: string;
    custom?: boolean;
  }[];
};

export const QuestionsToolUI = makeAssistantToolUI<QuestionArgs, QuestionResult>({
  toolName: "askQuestions",
  render: ({ args, addResult, result }) => {
    if (result) return <CompletedView result={result} />;
    if (!args?.questions) return null;
    return <PendingView questions={args.questions} onSubmit={addResult} />;
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

  function select(index: number, value: string) {
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
    <div className="my-2 space-y-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
      {questions.map((q, qi) => (
        <div key={qi} className="space-y-2">
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {q.question}
          </div>
          <div className="flex flex-wrap gap-2">
            {q.candidates.map((c) => (
              <button
                key={c.value}
                onClick={() => select(qi, c.value)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  selections[qi] === c.value
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300"
                    : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Or type your own..."
            value={customAnswers[qi] ?? ""}
            onChange={(e) => setCustom(qi, e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        </div>
      ))}
      <button
        onClick={handleSubmit}
        disabled={!hasAny}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
      >
        Submit Answers
      </button>
    </div>
  );
}

function CompletedView({ result }: { result: QuestionResult }) {
  return (
    <div className="my-2 space-y-1 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
        <CheckCircleIcon className="h-4 w-4" />
        Answers submitted
      </div>
      {result.answers.map((a, i) => (
        <div key={i} className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium">{a.question}</span>
          <span className="mx-1">&rarr;</span>
          <span className={a.custom ? "italic" : ""}>{a.answer}</span>
          {a.custom && (
            <span className="ml-1 text-xs text-zinc-400">(custom)</span>
          )}
        </div>
      ))}
    </div>
  );
}
