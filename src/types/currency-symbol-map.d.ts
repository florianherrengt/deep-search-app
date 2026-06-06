declare module "currency-symbol-map" {
  function getSymbolFromCurrency(currencyCode: string): string | undefined;
  namespace getSymbolFromCurrency {
    const currencySymbolMap: Record<string, string>;
  }
  export = getSymbolFromCurrency;
}
