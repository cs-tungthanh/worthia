import type { ReactNode } from "react";
import { ActionIcon, Box, Button, Group, Paper, Stack, Table, Text, Tooltip, UnstyledButton } from "@mantine/core";
import type { Quote } from "./api";
import { Money, useMoney } from "./currency";

export type SectionProps<T> = { rows: T[]; run: (p: Promise<unknown>) => void };

export { cell, money } from "./format";

export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

// Mantine NumberInput reports "" when empty.
export const toNumber = (v: number | string): number | null => (v === "" ? null : Number(v));

// Vietnamese grouping for money inputs: 1.000.000
export const vndInput = { thousandSeparator: ".", decimalSeparator: ",", allowNegative: false } as const;

export type Sort<K extends string> = { key: K; desc: boolean };

// A clickable column header: the first click sorts ascending (A→Z, low→high, oldest first), the next flips it.
export function SortHeader<K extends string>({
  label,
  k,
  sort,
  onSort,
  right = false,
}: {
  label: ReactNode;
  k: K;
  sort: Sort<K>;
  onSort: (s: Sort<K>) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <Table.Th ta={right ? "right" : undefined} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
      <UnstyledButton
        fw={600}
        fz="sm"
        onClick={() => onSort({ key: k, desc: active ? !sort.desc : false })}
        style={{ whiteSpace: "nowrap" }}
      >
        {label}{" "}
        <Text span inherit c={active ? undefined : "dimmed"} fw={400}>
          {active ? (sort.desc ? "↓" : "↑") : "↕"}
        </Text>
      </UnstyledButton>
    </Table.Th>
  );
}

const trendColor = (n: number) => (n > 0 ? "teal" : n < 0 ? "red" : undefined);

export function DayChange({ quote }: { quote: Quote | null | undefined }) {
  if (!quote?.prevClose) return null;
  const pct = ((quote.price - quote.prevClose) / quote.prevClose) * 100;
  return (
    <Text span inherit c={trendColor(pct)}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </Text>
  );
}

// cost and value are in `currency` (VND for stocks); shown in the user's display currency.
export function ProfitLoss({
  cost,
  value,
  currency = "VND",
  compact = false,
}: {
  cost: number;
  value: number;
  currency?: string;
  compact?: boolean;
}) {
  const { fmt } = useMoney();
  const diff = value - cost;
  const sign = diff > 0 ? "+" : "";
  const pct = cost > 0 ? ` (${sign}${((diff / cost) * 100).toFixed(2)}%)` : "";
  return (
    <Text span inherit c={trendColor(diff)}>
      {sign}
      {compact ? <Money amount={diff} from={currency} /> : fmt(diff, currency)}
      {pct}
    </Text>
  );
}

// Outline icons (Tabler style), inline so the app doesn't need an icon package.
const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const EditIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);

const HistoryIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <path d="M4 19h16" />
    <path d="M4 15l4-6 4 3 4-6 4 4" />
  </svg>
);

const DeleteIcon = () => (
  <svg {...iconProps} aria-hidden="true">
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
  </svg>
);

// `label` names the row for screen readers, e.g. "Edit VCB".
export function RowActions({
  label,
  onView,
  onEdit,
  onDelete,
}: {
  label?: string;
  onView?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const name = label ? ` ${label}` : "";
  return (
    <Group gap={2} justify="flex-end" wrap="nowrap">
      {onView && (
        <Tooltip label="Lifecycle" openDelay={400}>
          <ActionIcon variant="subtle" color="gray" aria-label={`Lifecycle${name}`} onClick={onView}>
            <HistoryIcon />
          </ActionIcon>
        </Tooltip>
      )}
      {onEdit && (
        <Tooltip label="Edit" openDelay={400}>
          <ActionIcon variant="subtle" color="gray" aria-label={`Edit${name}`} onClick={onEdit}>
            <EditIcon />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Delete" openDelay={400}>
        <ActionIcon variant="subtle" color="red" aria-label={`Delete${name}`} onClick={onDelete}>
          <DeleteIcon />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export function FormButtons({
  editing,
  addLabel,
  onCancel,
}: {
  editing: boolean;
  addLabel: string;
  onCancel: () => void;
}) {
  return (
    <Group gap="xs" wrap="nowrap" className="form-actions">
      <Button type="submit" flex={1}>
        {editing ? "Save" : addLabel}
      </Button>
      {editing && (
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </Group>
  );
}

// Phones and portrait tablets get one compact card per row; wider screens keep the table.
export function ResponsiveList({ table, cards }: { table: ReactNode; cards: ReactNode }) {
  return (
    <>
      <Box visibleFrom="md">{table}</Box>
      <Stack hiddenFrom="md" gap="xs">
        {cards}
      </Stack>
    </>
  );
}

export function MobileRow({
  title,
  label = typeof title === "string" ? title : undefined,
  subtitle,
  value,
  detail,
  onView,
  onEdit,
  onDelete,
}: {
  title: ReactNode;
  label?: string; // names the row for the edit/delete buttons; defaults to a string title
  subtitle?: ReactNode;
  value?: ReactNode;
  detail?: ReactNode;
  onView?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Box miw={0}>
          <Text fw={600} truncate>
            {title}
          </Text>
          {subtitle && (
            <Text size="sm" c="dimmed">
              {subtitle}
            </Text>
          )}
        </Box>
        <Box ta="right" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {value && <Text fw={600}>{value}</Text>}
          {detail && <Text size="sm">{detail}</Text>}
        </Box>
      </Group>
      <RowActions label={label} onView={onView} onEdit={onEdit} onDelete={onDelete} />
    </Paper>
  );
}
