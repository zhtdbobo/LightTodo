import { useState } from "react";

type DeadlineTimePart = "hour" | "minute";

interface TimePartInputProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}

const TimePartInput = ({ label, value, onCommit }: TimePartInputProps) => {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      aria-label={label}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={2}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(event) => {
        if (/^\d{0,2}$/.test(event.target.value)) {
          setDraft(event.target.value);
        }
      }}
      onBlur={(event) => {
        const nextValue = event.currentTarget.value;
        setDraft(null);
        if (nextValue) {
          onCommit(nextValue);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      autoComplete="off"
      className="w-12 rounded border border-gray-200 px-1 py-0.5 text-center text-gray-700 outline-none focus:border-cyan-400"
    />
  );
};

interface DeadlineTimeInputProps {
  hour: string;
  minute: string;
  onCommit: (part: DeadlineTimePart, value: string) => void;
}

export const DeadlineTimeInput = ({ hour, minute, onCommit }: DeadlineTimeInputProps) => (
  <div className="flex items-center gap-1">
    <TimePartInput label="小时" value={hour} onCommit={(value) => onCommit("hour", value)} />
    <span className="text-gray-400">:</span>
    <TimePartInput label="分钟" value={minute} onCommit={(value) => onCommit("minute", value)} />
  </div>
);
