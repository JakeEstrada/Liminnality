export type TakeoffRow = {
  item: string;
  qty: string;
  material: string;
  description: string;
  doubleHeight?: boolean;
};

export function newTakeoffRow(): TakeoffRow {
  return { item: '', qty: '', material: '', description: '' };
}

export function newDoubleTakeoffRow(): TakeoffRow {
  return { ...newTakeoffRow(), doubleHeight: true };
}

export function isEmptyTakeoffRow(row: TakeoffRow | null | undefined) {
  if (!row) return true;
  return ![row.item, row.qty, row.material, row.description].some((value) => String(value || '').trim());
}

/** Turn the first empty single-height row into a double, or append one. */
export function applyAddDoubleRow(rows: TakeoffRow[]): TakeoffRow[] {
  const list = Array.isArray(rows) ? rows : [];
  const firstEmptySingle = list.findIndex((row) => !row.doubleHeight && isEmptyTakeoffRow(row));
  if (firstEmptySingle >= 0) {
    return list.map((row, index) => (index === firstEmptySingle ? { ...row, doubleHeight: true } : row));
  }
  return [...list, newDoubleTakeoffRow()];
}

export function toggleTakeoffRowDouble(rows: TakeoffRow[], index: number): TakeoffRow[] {
  return (Array.isArray(rows) ? rows : []).map((row, i) => {
    if (i !== index) return row;
    if (row.doubleHeight) {
      const { doubleHeight: _ignored, ...rest } = row;
      return rest;
    }
    return { ...row, doubleHeight: true };
  });
}
