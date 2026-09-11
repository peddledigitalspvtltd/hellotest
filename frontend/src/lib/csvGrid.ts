/** Parse CSV text into rows of string cells (handles quoted fields and newlines). */
export function parseCsvGrid(text: string, options: { preserveWhitespace?: boolean; strict?: boolean } = {}): string[][] {
  const rows: string[][] = [];
  const cellValue = (value: string) => options.preserveWhitespace ? value : value.trim();
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        if (options.strict && !inQuotes && currentCell.length) throw new Error("A CSV quote must start at the beginning of a cell.");
        if (options.strict && inQuotes && nextCharacter && ![",", "\r", "\n"].includes(nextCharacter)) throw new Error("A closing CSV quote must be followed by a comma or line break.");
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === ",") {
      currentRow.push(cellValue(currentCell));
      currentCell = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(cellValue(currentCell));
      rows.push(currentRow);
      currentCell = "";
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (options.strict && inQuotes) throw new Error("A CSV quoted value is missing its closing quote.");
  if (currentCell || currentRow.length) {
    currentRow.push(cellValue(currentCell));
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim().length));
}
