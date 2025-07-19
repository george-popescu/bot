/**
 * MEXC formatting utilities based on exchange specifications
 */

// MEXC exchange specifications for ILMTUSDT
export const MEXC_ILMTUSDT_SPECS = {
  baseAssetPrecision: 2, // ILMT quantities: max 2 decimal places
  quoteAssetPrecision: 6, // USDT prices: max 6 decimal places
  minQuantity: 150, // Minimum 150 ILMT (~$1 USD at current price)
  maxQuantity: 9999999, // Maximum quantity
  stepSize: 0.01, // Step size for quantities
  minPrice: 0.000001, // Minimum price
  maxPrice: 999999, // Maximum price
  tickSize: 0.000001, // Price tick size
  minNotional: 1, // Minimum order value in USDT
};

/**
 * Format MEXC quantity with correct precision for ILMTUSDT
 * @param quantity - The quantity to format
 * @param symbol - The trading symbol (default: ILMTUSDT)
 * @returns Formatted quantity string
 */
export function formatMexcQuantity(
  quantity: number,
  symbol: string = 'ILMTUSDT',
): string {
  if (symbol === 'ILMTUSDT') {
    // For ILMTUSDT, base asset precision is 2 decimal places
    return quantity.toFixed(MEXC_ILMTUSDT_SPECS.baseAssetPrecision);
  }

  // For other symbols, use 8 decimal places as fallback
  return quantity.toFixed(8);
}

/**
 * Format MEXC price with correct precision for ILMTUSDT
 * @param price - The price to format
 * @param symbol - The trading symbol (default: ILMTUSDT)
 * @returns Formatted price string
 */
export function formatMexcPrice(
  price: number,
  symbol: string = 'ILMTUSDT',
): string {
  if (symbol === 'ILMTUSDT') {
    // For ILMTUSDT, quote asset precision is 6 decimal places
    return price.toFixed(MEXC_ILMTUSDT_SPECS.quoteAssetPrecision);
  }

  // For other symbols, use 8 decimal places as fallback
  return price.toFixed(8);
}

/**
 * Validate MEXC quantity for ILMTUSDT
 * @param quantity - The quantity to validate
 * @param symbol - The trading symbol (default: ILMTUSDT)
 * @returns Object with validation result and formatted quantity
 */
export function validateMexcQuantity(
  quantity: number,
  symbol: string = 'ILMTUSDT',
): {
  isValid: boolean;
  formattedQuantity: string;
  error?: string;
} {
  if (symbol === 'ILMTUSDT') {
    const specs = MEXC_ILMTUSDT_SPECS;

    // Check minimum quantity
    if (quantity < specs.minQuantity) {
      return {
        isValid: false,
        formattedQuantity: formatMexcQuantity(quantity, symbol),
        error: `Quantity ${quantity} is below minimum ${specs.minQuantity}`,
      };
    }

    // Check maximum quantity
    if (quantity > specs.maxQuantity) {
      return {
        isValid: false,
        formattedQuantity: formatMexcQuantity(quantity, symbol),
        error: `Quantity ${quantity} exceeds maximum ${specs.maxQuantity}`,
      };
    }

    // Check step size (quantity should be a multiple of step size)
    const remainder = quantity % specs.stepSize;
    if (remainder > 0.001) {
      // Allow small floating point errors
      return {
        isValid: false,
        formattedQuantity: formatMexcQuantity(quantity, symbol),
        error: `Quantity ${quantity} does not match step size ${specs.stepSize}`,
      };
    }

    return {
      isValid: true,
      formattedQuantity: formatMexcQuantity(quantity, symbol),
    };
  }

  // For other symbols, assume valid
  return {
    isValid: true,
    formattedQuantity: formatMexcQuantity(quantity, symbol),
  };
}

/**
 * Validate MEXC price for ILMTUSDT
 * @param price - The price to validate
 * @param symbol - The trading symbol (default: ILMTUSDT)
 * @returns Object with validation result and formatted price
 */
export function validateMexcPrice(
  price: number,
  symbol: string = 'ILMTUSDT',
): {
  isValid: boolean;
  formattedPrice: string;
  error?: string;
} {
  if (symbol === 'ILMTUSDT') {
    const specs = MEXC_ILMTUSDT_SPECS;

    // Check minimum price
    if (price < specs.minPrice) {
      return {
        isValid: false,
        formattedPrice: formatMexcPrice(price, symbol),
        error: `Price ${price} is below minimum ${specs.minPrice}`,
      };
    }

    // Check maximum price
    if (price > specs.maxPrice) {
      return {
        isValid: false,
        formattedPrice: formatMexcPrice(price, symbol),
        error: `Price ${price} exceeds maximum ${specs.maxPrice}`,
      };
    }

    return {
      isValid: true,
      formattedPrice: formatMexcPrice(price, symbol),
    };
  }

  // For other symbols, assume valid
  return {
    isValid: true,
    formattedPrice: formatMexcPrice(price, symbol),
  };
}

/**
 * Validate MEXC order notional value (quantity * price)
 * @param quantity - The order quantity
 * @param price - The order price
 * @param symbol - The trading symbol (default: ILMTUSDT)
 * @returns Object with validation result
 */
export function validateMexcNotional(
  quantity: number,
  price: number,
  symbol: string = 'ILMTUSDT',
): {
  isValid: boolean;
  notionalValue: number;
  error?: string;
} {
  const notionalValue = quantity * price;

  if (symbol === 'ILMTUSDT') {
    const specs = MEXC_ILMTUSDT_SPECS;

    if (notionalValue < specs.minNotional) {
      return {
        isValid: false,
        notionalValue,
        error: `Notional value ${notionalValue.toFixed(6)} USDT is below minimum ${specs.minNotional} USDT`,
      };
    }
  }

  return {
    isValid: true,
    notionalValue,
  };
}

/**
 * Format and validate a complete MEXC order
 * @param quantity - The order quantity
 * @param price - The order price (optional for market orders)
 * @param symbol - The trading symbol (default: ILMTUSDT)
 * @returns Object with formatted and validated order parameters
 */
export function formatMexcOrder(
  quantity: number,
  price?: number,
  symbol: string = 'ILMTUSDT',
): {
  isValid: boolean;
  formattedQuantity: string;
  formattedPrice: string | undefined;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate quantity
  const quantityValidation = validateMexcQuantity(quantity, symbol);
  if (!quantityValidation.isValid) {
    errors.push(quantityValidation.error!);
  }

  let formattedPrice: string | undefined;

  // Validate price if provided
  if (price !== undefined) {
    const priceValidation = validateMexcPrice(price, symbol);
    if (!priceValidation.isValid) {
      errors.push(priceValidation.error!);
    }
    formattedPrice = priceValidation.formattedPrice;

    // Validate notional value
    const notionalValidation = validateMexcNotional(quantity, price, symbol);
    if (!notionalValidation.isValid) {
      errors.push(notionalValidation.error!);
    }
  }

  return {
    isValid: errors.length === 0,
    formattedQuantity: quantityValidation.formattedQuantity,
    formattedPrice: formattedPrice || undefined,
    errors,
  };
}
