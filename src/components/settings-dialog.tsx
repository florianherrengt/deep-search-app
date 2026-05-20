import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSettings, type Settings } from "@/hooks/use-settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FieldConfig {
  key: keyof Settings;
  label: string;
  type: "text" | "password";
  placeholder: string;
}

const FIELDS: FieldConfig[] = [
  {
    key: "openrouter_api_key",
    label: "OpenRouter API Key",
    type: "password",
    placeholder: "sk-or-...",
  },
  {
    key: "searxng_url",
    label: "SearXNG URL",
    type: "text",
    placeholder: "http://localhost:8080",
  },
  {
    key: "brave_api_key",
    label: "Brave Search API Key",
    type: "password",
    placeholder: "BSA-...",
  },
  {
    key: "exa_api_key",
    label: "Exa API Key",
    type: "password",
    placeholder: "exa-...",
  },
  {
    key: "serper_api_key",
    label: "Serper API Key",
    type: "password",
    placeholder: "serper-...",
  },
  {
    key: "tavily_api_key",
    label: "Tavily API Key",
    type: "password",
    placeholder: "tvly-...",
  },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { settings, updateSetting, resetAll } = useSettings();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleBlur(key: keyof Settings, value: string) {
    if (value !== settings[key]) {
      updateSetting(key, value);
    }
  }

  function handleKeyDown(
    e: React.KeyboardEvent,
    key: keyof Settings,
    value: string,
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBlur(key, value);
    }
  }

  async function handleConfirmReset() {
    await resetAll();
    setConfirmOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure API keys and preferences. Changes are saved automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="default_model">Default Model (OpenRouter)</Label>
            <Input
              id="default_model"
              type="text"
              placeholder="openrouter/free"
              defaultValue={settings.default_model}
              onBlur={(e: FormEvent<HTMLInputElement>) =>
                handleBlur("default_model", e.currentTarget.value)
              }
              onKeyDown={(e: React.KeyboardEvent) =>
                handleKeyDown(
                  e,
                  "default_model",
                  (e.target as HTMLInputElement).value,
                )
              }
            />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">API Keys &amp; Services</p>
          </div>

          {FIELDS.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                type={field.type}
                placeholder={field.placeholder}
                defaultValue={settings[field.key]}
                onBlur={(e: FormEvent<HTMLInputElement>) =>
                  handleBlur(field.key, e.currentTarget.value)
                }
                onKeyDown={(e: React.KeyboardEvent) =>
                  handleKeyDown(
                    e,
                    field.key,
                    (e.target as HTMLInputElement).value,
                  )
                }
              />
            </div>
          ))}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t pt-4">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            Reset All Settings
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Reset All Settings</AlertDialogTitle>
          <AlertDialogDescription>
            This will clear all API keys and preferences. This action cannot be
            undone.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmReset}
              >
                Confirm Reset
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
