/** Read a trimmed string field from FormData; returns "" for missing or non-string values. */
export function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Read a checkbox field; returns true iff the checkbox is "on". */
export function readCheckbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}
