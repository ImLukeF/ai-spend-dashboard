export function valueAxis(currency?: string) {
  const format = new Intl.NumberFormat(
    undefined,
    currency ? { style: "currency", currency } : undefined,
  );
  return {
    stacked: true,
    beginAtZero: true,
    title: { display: true, text: currency ? `Spend (${currency})` : "Tokens" },
    ticks: { callback: (value: string | number) => format.format(Number(value)) },
  };
}
