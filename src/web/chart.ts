export function valueAxis(currency?: string) {
  const format = new Intl.NumberFormat(
    undefined,
    // Up to four decimals so small-spend axes don't read $0.00, $0.01, $0.01.
    currency ? { style: "currency", currency, maximumFractionDigits: 4 } : undefined,
  );
  return {
    stacked: true,
    beginAtZero: true,
    title: { display: true, text: currency ? `Spend (${currency})` : "Tokens" },
    ticks: { callback: (value: string | number) => format.format(Number(value)) },
  };
}
