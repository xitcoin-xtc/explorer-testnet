import { fromBech32 } from '@cosmjs/encoding';

export const XITCOIN = Object.freeze({
  chainId: 'xitcoin-testnet-v2-1',
  chainName: 'Xitcoin Public Testnet',
  coinDenom: 'XTC',
  coinMinimalDenom: 'axtc',
  coinDecimals: 18,
  rest: 'https://api-testnet.xitchain.com',
  rpc: 'https://rpc-testnet.xitchain.com',
});

export function validAddress(value: string, prefix = 'xtc') {
  try {
    const decoded = fromBech32(value);
    return decoded.prefix === prefix && decoded.data.length === 20;
  } catch {
    return false;
  }
}

export function baseAmount(value: string): string {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) {
    throw new Error('Enter a positive amount with at most 18 decimal places.');
  }
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole + fraction.padEnd(18, '0'));
  if (amount <= 0n) throw new Error('Amount must be greater than zero.');
  return amount.toString();
}

export function displayAmount(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error('Malformed balance data.');
  const padded = value.padStart(19, '0');
  const fraction = padded.slice(-18).replace(/0+$/, '');
  return `${BigInt(padded.slice(0, -18))}${fraction ? `.${fraction}` : ''}`;
}

export function parseBalances(data: any): string {
  if (
    !Array.isArray(data?.balances) ||
    data.balances.some(
      (coin: any) =>
        typeof coin?.denom !== 'string' ||
        typeof coin?.amount !== 'string' ||
        !/^\d+$/.test(coin.amount)
    )
  )
    throw new Error('Malformed balance data.');
  if (data.pagination?.next_key)
    throw new Error('Incomplete balance data. Transactions are disabled.');
  const coins = data.balances.filter(
    (coin: any) => coin.denom === XITCOIN.coinMinimalDenom
  );
  if (coins.length > 1) throw new Error('Malformed balance data.');
  return coins[0]?.amount || '0';
}

export interface DialogValidator {
  address: string;
  name: string;
}
export function parseValidators(data: any): DialogValidator[] {
  if (
    !Array.isArray(data?.validators) ||
    data.validators.some(
      (v: any) =>
        !validAddress(v?.operator_address, 'xtcvaloper') ||
        typeof v?.description?.moniker !== 'string' ||
        !v.description.moniker.trim() ||
        v.status !== 'BOND_STATUS_BONDED'
    )
  )
    throw new Error('Malformed validator data.');
  return data.validators.map((v: any) => ({
    address: v.operator_address,
    name: v.description.moniker,
  }));
}

export async function getDialogData(sender: string, signal: AbortSignal) {
  async function get(path: string) {
    const response = await fetch(`${XITCOIN.rest}${path}`, { signal });
    if (!response.ok)
      throw new Error('Xitcoin API is unavailable. Please retry.');
    try {
      return await response.json();
    } catch {
      throw new Error('Malformed API data.');
    }
  }
  const [node, staking] = await Promise.all([
    get('/cosmos/base/tendermint/v1beta1/node_info'),
    get('/cosmos/staking/v1beta1/params'),
  ]);
  if (
    node?.default_node_info?.network !== XITCOIN.chainId ||
    staking?.params?.bond_denom !== XITCOIN.coinMinimalDenom
  ) {
    throw new Error(
      'Unexpected chain configuration. Transactions are disabled.'
    );
  }
  const validators: DialogValidator[] = [];
  const seen = new Set<string>();
  let key = '';
  do {
    const page = await get(
      `/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100${key ? `&pagination.key=${encodeURIComponent(key)}` : ''}`
    );
    validators.push(...parseValidators(page));
    const next = page.pagination?.next_key;
    if (next != null && typeof next !== 'string')
      throw new Error('Malformed validator pagination.');
    key = next || '';
    if (key && seen.has(key))
      throw new Error('Malformed validator pagination.');
    seen.add(key);
    if (seen.size > 100)
      throw new Error('Validator pagination limit exceeded.');
  } while (key);
  if (new Set(validators.map((v) => v.address)).size !== validators.length)
    throw new Error('Duplicate validator data.');
  let balance = '0';
  if (sender) {
    if (!validAddress(sender))
      throw new Error('Connect a valid Xitcoin wallet.');
    balance = parseBalances(
      await get(`/cosmos/bank/v1beta1/balances/${sender}?pagination.limit=1000`)
    );
  }
  return {
    validators: validators.sort((a, b) => a.name.localeCompare(b.name)),
    balance,
  };
}

export function transactionMessage(
  type: string,
  sender: string,
  destination: string,
  amount: string
) {
  if (
    !validAddress(sender) ||
    !validAddress(destination, type === 'delegate' ? 'xtcvaloper' : 'xtc')
  ) {
    throw new Error('Enter a valid Xitcoin address.');
  }
  const coin = { denom: XITCOIN.coinMinimalDenom, amount: baseAmount(amount) };
  return type === 'delegate'
    ? {
        typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
        value: {
          delegatorAddress: sender,
          validatorAddress: destination,
          amount: coin,
        },
      }
    : {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        value: { fromAddress: sender, toAddress: destination, amount: [coin] },
      };
}
