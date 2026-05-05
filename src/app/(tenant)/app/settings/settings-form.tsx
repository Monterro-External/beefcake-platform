'use client';

/**
 * The numeric settings, each with the value in force and whether it is this
 * operator's or the platform default. "Use default" removes the override rather
 * than writing the default value, so a later change to the default reaches them.
 */

import { useState, useTransition } from 'react';
import { Badge, Button, Callout, Input } from '@/components/ui';
import { clearSetting, setNumericSetting } from '@/app/actions/settings';
import type { ActionResult } from '@/app/actions/subscriptions';

interface SettingRow {
  key: string;
  label: string;
  value: number;
  fallback: number;
  hint?: string;
}

export function SettingsForm({
  settings,
  editable,
  overridden,
}: {
  settings: SettingRow[];
  editable: boolean;
  overridden: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(settings.map((setting) => [setting.key, String(setting.value)])),
  );

  function run(action: () => Promise<ActionResult>): void {
    startTransition(async () => {
      setResult(await action());
    });
  }

  return (
    <div className="space-y-3">
      {result !== null && <Callout tone={result.ok ? 'good' : 'bad'}>{result.message}</Callout>}

      {settings.map((setting) => {
        const isOverridden = overridden.includes(setting.key);
        return (
          <div key={setting.key} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={setting.key} className="font-medium">
                {setting.label}
              </label>
              {isOverridden ? (
                <Badge tone="info">Set by this operator</Badge>
              ) : (
                <Badge tone="neutral">Platform default</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                id={setting.key}
                type="number"
                className="w-24"
                value={drafts[setting.key] ?? ''}
                disabled={!editable || pending}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
                }
              />
              {editable && (
                <>
                  <Button
                    disabled={pending || drafts[setting.key] === String(setting.value)}
                    onClick={() => run(() => setNumericSetting(setting.key, drafts[setting.key] ?? ''))}
                  >
                    Save
                  </Button>
                  {isOverridden && (
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => clearSetting(setting.key))}
                    >
                      Use default ({setting.fallback})
                    </Button>
                  )}
                </>
              )}
            </div>
            {setting.hint !== undefined && <p className="text-ink-muted">{setting.hint}</p>}
          </div>
        );
      })}
    </div>
  );
}
