import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function ToolFallback({
  toolName,
  args,
  result,
  status,
}: {
  toolName: string;
  args?: unknown;
  result?: unknown;
  status: "running" | "complete" | "error";
}) {
  return (
    <Collapsible className="my-2 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
          "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        )}
      >
        <WrenchIcon className="h-3.5 w-3.5 text-zinc-400" />
        <span className="font-medium text-zinc-700 dark:text-zinc-200">
          {toolName}
        </span>
        {status === "running" && (
          <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
        )}
        {status === "complete" && (
          <span className="ml-auto text-xs text-green-600 dark:text-green-400">
            done
          </span>
        )}
        {status === "error" && (
          <span className="ml-auto text-xs text-red-500">error</span>
        )}
        <ChevronDownIcon
          className={cn(
            "h-3.5 w-3.5 text-zinc-400 transition-transform duration-200",
            "group-data-[state=open]:rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-zinc-200 dark:border-zinc-700">
        <div className="px-3 py-2">
          {formatValue(args) && (
            <div className="mb-2">
              <div className="mb-1 text-xs font-medium text-zinc-500">
                Input
              </div>
              <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs whitespace-pre-wrap dark:bg-zinc-900">
                {formatValue(args)}
              </pre>
            </div>
          )}
          {formatValue(result) && (
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-500">
                Result
              </div>
              <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs whitespace-pre-wrap dark:bg-zinc-900">
                {formatValue(result)}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
