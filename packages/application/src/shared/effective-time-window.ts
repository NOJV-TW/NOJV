import { ValidationError } from "./errors";

interface EffectiveTimeWindow {
  start: Date;
  end: Date;
  due?: Date | null;
  fields: {
    start: string;
    end: string;
    due?: string;
  };
}

export function assertEffectiveTimeWindow({
  start,
  end,
  due,
  fields,
}: EffectiveTimeWindow): void {
  if (start >= end) {
    throw new ValidationError(`${fields.end} must be later than ${fields.start}.`);
  }
  if (due && start >= due) {
    throw new ValidationError(`${fields.due ?? "dueAt"} must be later than ${fields.start}.`);
  }
  if (due && due > end) {
    throw new ValidationError(
      `${fields.end} must be later than or equal to ${fields.due ?? "dueAt"}.`,
    );
  }
}
