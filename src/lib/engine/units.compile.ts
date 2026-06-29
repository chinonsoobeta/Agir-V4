import {
  money,
  months,
  percent,
  perSf,
  type Money,
  type Months,
  type PerSF,
  type Percent,
} from "./units";

const typedMoney: Money = money(1);
const typedPercent: Percent = percent(1);
const typedMonths: Months = months(1);
const typedPerSf: PerSF = perSf(1);

void [typedMoney, typedPercent, typedMonths, typedPerSf];

// @ts-expect-error $/SF is not money.
const badMoney: Money = perSf(1);
// @ts-expect-error a percent is not a month count.
const badMonths: Months = percent(1);

void [badMoney, badMonths];
