<script setup lang="ts">
import { walletPublicName } from '@/libs/explorerPresentation';
import { computed, onMounted, ref } from 'vue';
import {
  useDashboard,
  useBlockchain,
} from '@/stores';
import type { ChainConfig } from '@/types/chaindata';
import { NetworkType } from '@/types/chaindata';
import { CosmosRestClient } from '@/libs/client';

const error = ref('');
const conf = ref('');
const pageRevision = 'xitcoin-testnet-wallet-helper-v3';
const dashboard = useDashboard();
const selected = ref({} as ChainConfig);
const wallet = ref('keplr');
const network = ref(NetworkType.Testnet);
const mainnet = ref([] as ChainConfig[]);
const testnet = ref([] as ChainConfig[]);
const chains = computed(() => {
  return network.value === NetworkType.Mainnet ? mainnet.value : testnet.value;
});

onMounted(async () => {
  const chainStore = useBlockchain();
  const [mainnetConfig, testnetConfig] = await Promise.all([
    dashboard.loadLocalConfig(NetworkType.Mainnet),
    dashboard.loadLocalConfig(NetworkType.Testnet),
  ]);

  mainnet.value = Object.values<ChainConfig>(mainnetConfig).filter((chain) =>
    chain.chainName.toLowerCase().includes('xitcoin')
  );
  testnet.value = Object.values<ChainConfig>(testnetConfig).filter((chain) =>
    chain.chainName.toLowerCase().includes('xitcoin')
  );

  const current = chainStore.current;
  const currentTestnet = current && testnet.value.find((chain) => chain.chainName === current.chainName);
  const currentMainnet = current && mainnet.value.find((chain) => chain.chainName === current.chainName);

  if (currentTestnet) {
    network.value = NetworkType.Testnet;
    selected.value = currentTestnet;
  } else if (currentMainnet) {
    network.value = NetworkType.Mainnet;
    selected.value = currentMainnet;
  } else if (testnet.value.length > 0) {
    network.value = NetworkType.Testnet;
    selected.value = testnet.value[0];
  } else if (mainnet.value.length > 0) {
    network.value = NetworkType.Mainnet;
    selected.value = mainnet.value[0];
  }

  await onchange();
});

async function changeNetwork() {
  selected.value = chains.value[0] || ({} as ChainConfig);
  await onchange();
}

async function onchange() {
  error.value = '';
  if (!selected.value?.chainName) {
    conf.value = '';
    return;
  }

  try {
    wallet.value === 'keplr' ? await initParamsForKeplr() : initParamsForMetamask();
  } catch (cause) {
    conf.value = '';
    error.value = cause instanceof Error ? cause.message : 'Unable to load wallet parameters';
  }
}

async function initParamsForKeplr() {
  const chain = selected.value;
  if (!chain.endpoints?.rest?.at(0)) throw new Error('REST endpoint is not configured');
  const client = CosmosRestClient.newDefault(chain.endpoints.rest?.at(0)?.address || '');
  const b = await client.getBaseBlockLatest();
  const chainid = b.block.header.chain_id;

  const gasPriceStep = chain.keplrPriceStep || {
    low: 0.01,
    average: 0.025,
    high: 0.03,
  };
  const coinDecimals =
    chain.assets[0].denom_units.find((x) => x.denom === chain.assets[0].symbol.toLowerCase())?.exponent || 6;
  conf.value = JSON.stringify(
    {
      chainId: chainid,
      chainName: walletPublicName(chain),
      rpc: chain.endpoints?.rpc?.at(0)?.address,
      rest: chain.endpoints?.rest?.at(0)?.address,
      bip44: {
        coinType: Number(chain.coinType),
      },
      coinType: Number(chain.coinType),
      bech32Config: {
        bech32PrefixAccAddr: chain.bech32Prefix,
        bech32PrefixAccPub: `${chain.bech32Prefix}pub`,
        bech32PrefixValAddr: `${chain.bech32Prefix}valoper`,
        bech32PrefixValPub: `${chain.bech32Prefix}valoperpub`,
        bech32PrefixConsAddr: `${chain.bech32Prefix}valcons`,
        bech32PrefixConsPub: `${chain.bech32Prefix}valconspub`,
      },
      currencies: [
        {
          coinDenom: chain.assets[0].symbol,
          coinMinimalDenom: chain.assets[0].base,
          coinDecimals,
          coinGeckoId: chain.assets[0].coingecko_id || undefined,
        },
      ],
      feeCurrencies: [
        {
          coinDenom: chain.assets[0].symbol,
          coinMinimalDenom: chain.assets[0].base,
          coinDecimals,
          coinGeckoId: chain.assets[0].coingecko_id || undefined,
          gasPriceStep,
        },
      ],
      gasPriceStep,
      stakeCurrency: {
        coinDenom: chain.assets[0].symbol,
        coinMinimalDenom: chain.assets[0].base,
        coinDecimals,
        coinGeckoId: chain.assets[0].coingecko_id || undefined,
      },
      features: chain.keplrFeatures || [],
    },
    null,
    '\t'
  );
}

function initParamsForMetamask() {
  conf.value = JSON.stringify(
    {
      chainId: '0x18ae1',
      chainName: 'Xitcoin Public Testnet',
      nativeCurrency: {
        name: 'Xitcoin',
        symbol: 'XTC',
        decimals: 18,
      },
      rpcUrls: ['https://evm-rpc-testnet.xitchain.com'],
      blockExplorerUrls: ['https://evm-explorer-testnet.xitchain.com'],
    },
    null,
    '\t'
  );
}

async function suggest() {
  error.value = '';
  if (!conf.value) return;

  if (wallet.value === 'keplr') {
    // @ts-ignore
    if (window.keplr) {
      // @ts-ignore
      window.keplr.experimentalSuggestChain(JSON.parse(conf.value)).catch((cause: unknown) => {
        error.value = cause instanceof Error ? cause.message : String(cause);
      });
    } else {
      error.value = 'Keplr is not available in this browser';
    }
    return;
  }

  const ethereum = (
    window as typeof window & {
      ethereum?: {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
    }
  ).ethereum;

  if (!ethereum) {
    error.value = 'Metamask is not available in this browser';
    return;
  }

  try {
    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [JSON.parse(conf.value)],
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

</script>

<template>
  <div :data-revision="pageRevision" class="rounded bg-base-100 p-4 text-center">
    <div class="grid grid-cols-1 gap-4 text-left md:grid-cols-2">
      <label class="form-control w-full">
        <span class="label-text mb-2">Network</span>
        <select v-model="network" class="select select-bordered w-full" @change="changeNetwork">
          <option v-if="mainnet.length" :value="NetworkType.Mainnet">Mainnet</option>
          <option :value="NetworkType.Testnet">Testnet</option>
        </select>
      </label>

      <label class="form-control w-full">
        <span class="label-text mb-2">Chain</span>
        <select v-model="selected" class="select select-bordered w-full" @change="onchange">
          <option v-for="c in chains" :key="c.chainName" :value="c">
            {{ c.prettyName || c.chainName }}
          </option>
        </select>
      </label>
    </div>

    <div class="mt-4 flex items-center justify-center gap-6">
      <label class="flex cursor-pointer items-center gap-2">
        <input v-model="wallet" type="radio" value="keplr" class="radio radio-bordered" @change="onchange" />
        Keplr
      </label>
      <label class="flex cursor-pointer items-center gap-2">
        <input v-model="wallet" type="radio" value="metamask" class="radio radio-bordered" @change="onchange" />
        Metamask
      </label>
    </div>

    <p class="mt-4 text-left" v-if="selected.chainName === 'xitcoin-testnet'">Cosmos chain ID: <strong>xitcoin-testnet-v2-1</strong>. EVM chain ID: <strong>101089</strong>. Explorer route: <code>xitcoin-testnet</code>.</p>
    <div class="text-main mt-5">
      <textarea aria-label="Wallet network parameters" v-model="conf" class="textarea textarea-bordered w-full font-mono text-sm" rows="15" readonly></textarea>
    </div>

    <div v-if="error" class="alert alert-error mt-4 text-left" role="alert">
      {{ error }}
    </div>

    <div class="mb-4 mt-4">
      <button
        class="btn btn-primary mr-2 text-white"
        :disabled="!selected.chainName || !conf"
        @click="suggest"
      >
        <span v-if="wallet === 'keplr'">Suggest {{ selected.prettyName || selected.chainName }} to Keplr</span>
        <span v-else>Add Xitcoin Public Testnet to Metamask</span>
      </button>

      <div class="mt-4 text-sm text-base-content/70">
        <span v-if="wallet === 'keplr'">
          If the chain is not officially supported by Keplr, submit these parameters to enable it.
        </span>
        <span v-else>
          Add the Xitcoin EVM network (chain ID 101089) to Metamask.
        </span>
      </div>
    </div>

  </div>
</template>
