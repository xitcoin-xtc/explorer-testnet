const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
const repo = require('path').resolve(__dirname, '..');
const { toBech32 } = require(repo + '/node_modules/@cosmjs/encoding');
const { Tx } = require(
  repo + '/node_modules/cosmjs-types/cosmos/tx/v1beta1/tx'
);
const { MsgSend } = require(
  repo + '/node_modules/cosmjs-types/cosmos/bank/v1beta1/tx'
);
const { MsgDelegate } = require(
  repo + '/node_modules/cosmjs-types/cosmos/staking/v1beta1/tx'
);
const out = process.env.EVIDENCE_DIR || repo + '/.browser-results';
fs.mkdirSync(out, { recursive: true });
const fixtures = __dirname + '/fixtures/wallet-dialog';
const base = process.env.BASE || 'http://testnet.localhost:4176';
const tag = process.env.TAG || 'candidate';
const sender = toBech32('xtc', new Uint8Array(20).fill(7));
const recipient = toBech32('xtc', new Uint8Array(20).fill(8));
const validators = JSON.parse(fs.readFileSync(fixtures + '/validators.json'));
const rpcStatus = JSON.parse(
  fs.readFileSync(fixtures + '/rpc-status.json')
).result;
const reports = [];
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const mobile of [false, true])
    for (const scenario of [
      'connected',
      'light',
      'no-wallet',
      'rejected',
      'api-down',
      'malformed',
      'wrong-chain',
      'bad-balance',
      'bad-simulation',
      'bad-account',
    ].filter(
      (scenario) =>
        !process.env.SCENARIOS ||
        process.env.SCENARIOS.split(',').includes(scenario)
    )) {
      const context = await browser.newContext({
        isMobile: mobile,
        hasTouch: mobile,
        viewport: mobile
          ? { width: Number(process.env.MOBILE_WIDTH) || 390, height: 844 }
          : { width: 1440, height: 1000 },
      });
      const record = {
        mobile,
        scenario,
        simulations: [],
        blocked: [],
        errors: [],
        dialogs: [],
      };
      reports.push(record);
      await context.addInitScript(
        ({ sender, scenario }) => {
          window.__walletCalls = [];
          if (scenario === 'light') localStorage.setItem('theme', 'light');
          const deny = async () => {
            window.__walletCalls.push({ method: 'SIGNATURE_FORBIDDEN' });
            throw new Error('Signing forbidden in test');
          };
          if (scenario !== 'no-wallet') {
            localStorage.setItem(
              "m/44'/60/0'/0/0",
              JSON.stringify({
                wallet: 'keplr',
                cosmosAddress: sender,
                hdPath: "m/44'/60/0'/0/0",
              })
            );
            window.keplr = {
              enable: async (chainId) => {
                window.__walletCalls.push({ method: 'enable', chainId });
                if (scenario === 'rejected')
                  throw new Error('Request rejected by user.');
              },
              getOfflineSigner: (chainId) => {
                window.__walletCalls.push({
                  method: 'getOfflineSigner',
                  chainId,
                });
                return {
                  getAccounts: async () => [
                    {
                      address: sender,
                      algo: 'secp256k1',
                      pubkey: Uint8Array.from([2, ...Array(32).fill(1)]),
                    },
                  ],
                  signDirect: deny,
                  signAmino: deny,
                };
              },
              signDirect: deny,
              signAmino: deny,
              sendTx: deny,
            };
          }
        },
        { sender, scenario }
      );
      let armed = false;
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();
        try {
          if (url === 'https://rpc-testnet.xitchain.com/status')
            return route.fulfill({
              json: { jsonrpc: '2.0', id: -1, result: rpcStatus },
            });
          if (
            url ===
              'https://api-testnet.xitchain.com/cosmos/tx/v1beta1/simulate' &&
            request.method() === 'POST'
          ) {
            const input = request.postDataJSON();
            const tx = Tx.decode(Buffer.from(input.tx_bytes, 'base64'));
            assert.ok(
              tx.signatures.every((signature) => signature.length === 0),
              'simulation must contain no signature'
            );
            assert.equal(
              tx.authInfo.signerInfos[0].publicKey.typeUrl,
              '/cosmos.evm.crypto.v1.ethsecp256k1.PubKey'
            );
            const any = tx.body.messages[0];
            const msg = any.typeUrl.endsWith('MsgSend')
              ? MsgSend.decode(any.value)
              : MsgDelegate.decode(any.value);
            const coin = Array.isArray(msg.amount) ? msg.amount[0] : msg.amount;
            assert.equal(coin.denom, 'axtc');
            assert.equal(coin.amount, '1000000000000000001');
            assert.equal(msg.fromAddress || msg.delegatorAddress, sender);
            record.simulations.push({
              type: any.typeUrl,
              amount: coin.amount,
              denom: coin.denom,
              sender,
              signatures: tx.signatures.map((signature) => signature.length),
              publicKeyType: tx.authInfo.signerInfos[0].publicKey.typeUrl,
            });
            if (scenario === 'bad-simulation')
              return route.fulfill({
                json: { gas_info: { gas_used: 'invalid' } },
              });
            return route.fulfill({
              json: { gas_info: { gas_wanted: '100000', gas_used: '100000' } },
            });
          }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
            record.blocked.push({ url, method: request.method() });
            return route.abort();
          }
          if (url.startsWith('https://rpc-testnet.xitchain.com')) {
            const response = await route.fetch();
            return route.fulfill({
              response,
              headers: {
                ...response.headers(),
                'access-control-allow-origin': '*',
              },
            });
          }
          if (url.startsWith('https://api-testnet.xitchain.com')) {
            if (
              url.includes('/accounts/' + sender) &&
              scenario === 'bad-account'
            )
              return route.fulfill({
                json: { account: { address: 'malformed' } },
              });
            if (url.includes('/accounts/' + sender))
              return route.fulfill({
                json: {
                  account: {
                    '@type': '/cosmos.auth.v1beta1.BaseAccount',
                    address: sender,
                    pub_key: {
                      '@type': '/cosmos.evm.crypto.v1.ethsecp256k1.PubKey',
                      key: Buffer.from([2, ...Array(32).fill(1)]).toString(
                        'base64'
                      ),
                    },
                    account_number: '7',
                    sequence: '0',
                  },
                },
              });
            if (url.includes('/node_info')) {
              if (armed && scenario === 'api-down')
                return route.fulfill({
                  status: 503,
                  json: { error: 'controlled outage' },
                });
              if (armed && scenario === 'wrong-chain')
                return route.fulfill({
                  json: { default_node_info: { network: 'wrong-chain' } },
                });
            }
            if (url.includes('/validators?')) {
              if (armed && scenario === 'malformed')
                return route.fulfill({
                  json: {
                    validators: [
                      { operator_address: 'bad', description: null },
                    ],
                  },
                });
              // Live API snapshot, including the real operator addresses and names.
              return route.fulfill({ json: validators });
            }
            if (
              armed &&
              url.includes('/balances/' + sender) &&
              scenario === 'bad-balance'
            )
              return route.fulfill({
                json: { balances: [{ denom: 'axtc', amount: 'NaN' }] },
              });
            if (url.includes('/balances/' + sender))
              return route.fulfill({
                json: {
                  balances: [{ denom: 'axtc', amount: '25000000000000000000' }],
                  pagination: { next_key: null, total: '1' },
                },
              });
            const response = await route.fetch();
            return route.fulfill({
              response,
              headers: {
                ...response.headers(),
                'access-control-allow-origin': '*',
              },
            });
          }
          return route.continue();
        } catch (e) {
          record.errors.push(String(e));
          return route.abort();
        }
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => record.errors.push(String(e)));
      try {
        await page.goto(base + '/xitcoin-testnet', {
          waitUntil: 'domcontentloaded',
        });
        const send = page.getByRole('button', { name: 'Send', exact: true });
        await send.waitFor();
        await page.waitForTimeout(1800);
        armed = true;
        if (scenario === 'light') {
          await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
          await page.waitForTimeout(600);
          const violations = await page.evaluate(async () =>
            (await axe.run(document, { runOnly: ['color-contrast'] })).violations
              .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))
          );
          assert.deepEqual(violations, [], 'light dashboard contrast');
        }
        for (const type of ['Send', 'Delegate']) {
          const trigger = page.getByRole('button', { name: type, exact: true });
          await trigger.focus();
          await page.keyboard.press('Enter');
          const dialog = page.getByRole('dialog', { name: type, exact: true });
          await dialog.waitFor();
          await page.waitForTimeout(1200);
          await assert.equal(
            await dialog
              .locator('[data-chain-id]')
              .getAttribute('data-chain-id'),
            'xitcoin-testnet-v2-1'
          );
          for (const [key, value] of Object.entries({
            'data-rest': 'https://api-testnet.xitchain.com',
            'data-rpc': 'https://rpc-testnet.xitchain.com',
            'data-denom': 'axtc',
            'data-decimals': '18',
          }))
            assert.equal(
              await dialog.locator('[data-chain-id]').getAttribute(key),
              value
            );
          const text = await dialog.innerText();
          assert.ok(!/cosmoshub-4|\bATOM\b/.test(text));
          assert.match(text, /Xitcoin Public Testnet/);
          assert.match(text, /XTC/);
          assert.equal(
            await dialog.locator('#xitcoin-tx-sender').inputValue(),
            scenario === 'no-wallet' ? '' : sender
          );
          if (
            [
              'connected',
              'light',
              'no-wallet',
              'rejected',
              'bad-simulation',
              'bad-account',
            ].includes(scenario)
          ) {
            if (type === 'Delegate') {
              const options = await dialog
                .locator('select option')
                .allTextContents();
              for (const name of ['Atlas', 'Borealis', 'Meridian', 'Zenith'])
                assert.ok(
                  options.some((x) => x.includes(name)),
                  name
                );
            }
            if (scenario === 'no-wallet') {
              assert.match(text, /No wallet connected/);
              assert.equal(
                await dialog
                  .getByRole('button', { name: 'Simulate', exact: true })
                  .isDisabled(),
                true
              );
            } else {
              assert.match(text, /Available: 25 XTC/);
              if (type === 'Delegate')
                await dialog
                  .locator('select')
                  .selectOption(validators.validators[0].operator_address);
              else
                await dialog
                  .getByLabel('Recipient', { exact: true })
                  .fill(recipient);
              await dialog
                .getByLabel('Amount (XTC)', { exact: true })
                .fill('1.000000000000000001');
              await dialog
                .getByRole('button', { name: 'Simulate', exact: true })
                .click();
              if (scenario === 'rejected')
                await dialog
                  .getByRole('alert')
                  .filter({ hasText: 'Request rejected by user' })
                  .waitFor();
              else if (
                scenario === 'bad-simulation' ||
                scenario === 'bad-account'
              )
                await dialog
                  .getByRole('alert')
                  .filter({ hasText: 'Malformed' })
                  .waitFor();
              else
                await dialog
                  .getByRole('status')
                  .filter({ hasText: 'Simulation successful' })
                  .waitFor({ timeout: 15000 });
            }
          } else {
            await dialog.getByRole('alert').waitFor();
            assert.equal(
              await dialog
                .getByRole('button', { name: 'Simulate', exact: true })
                .isDisabled(),
              true
            );
          }
          await page.addScriptTag({
            path: require.resolve('axe-core/axe.min.js'),
          });
          const accessibility = await page.evaluate(
            async () =>
              (
                await axe.run(document.querySelector('dialog[open]'), {
                  runOnly: {
                    type: 'tag',
                    values: ['wcag2a', 'wcag2aa', 'wcag21aa'],
                  },
                })
              ).violations
          );
          assert.deepEqual(
            accessibility.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => n.target),
            })),
            []
          );
          await page.screenshot({
            path: `${out}/${tag}-${scenario}-${mobile ? 'mobile' : 'desktop'}-${type}.png`,
          });
          const bounds = await dialog.boundingBox();
          assert.ok(
            bounds.x >= 0 &&
              bounds.x + bounds.width <=
                (mobile ? Number(process.env.MOBILE_WIDTH) || 390 : 1440)
          );
          await dialog.getByRole('button', { name: 'Close dialog' }).focus();
          await page.keyboard.press('Shift+Tab');
          assert.equal(
            await page.evaluate(
              () => !!document.activeElement.closest('dialog')
            ),
            true,
            'focus stays in dialog'
          );
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'hidden' });
          assert.equal(
            await trigger.evaluate((el) => el === document.activeElement),
            true,
            'focus returns to trigger'
          );
          record.dialogs.push({ type, passed: true });
        }
        record.walletCalls = await page.evaluate(() => window.__walletCalls);
        if (scenario === 'light') {
          for (const path of ['staking', 'block', 'consensus']) {
            await page.goto(`${base}/xitcoin-testnet/${path}`, {
              waitUntil: 'domcontentloaded',
            });
            await page.getByRole('button', { name: 'Change color theme' }).waitFor();
            await page.waitForTimeout(1800);
            await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
            const violations = await page.evaluate(async () =>
              (await axe.run(document, { runOnly: ['color-contrast'] })).violations
                .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))
            );
            assert.deepEqual(violations, [], `light ${path} contrast`);
          }
        }
        assert.ok(
          record.walletCalls.every(
            (call) =>
              call.method !== 'SIGNATURE_FORBIDDEN' &&
              (!call.chainId || call.chainId === 'xitcoin-testnet-v2-1')
          )
        );
        assert.equal(record.blocked.length, 0);
        assert.deepEqual(record.errors, []);
        if (['connected', 'light'].includes(scenario))
          assert.equal(record.simulations.length, 2);
        record.passed = true;
      } catch (e) {
        record.failure = String(e);
        console.error(record);
      }
      fs.writeFileSync(
        `${out}/${tag}-browser.json`,
        JSON.stringify(reports, null, 2)
      );
      console.log(mobile, scenario, record.passed || record.failure);
      await context.close();
    }
  await browser.close();
  if (reports.some((r) => !r.passed)) process.exitCode = 1;
})();
