# Preamble

This implementation was inspired by EVM world dApps and Metamask wallet. Metamask, being a HDWallet under the hood, only allows to connect one address (account) to an app. BCH and Electron Cash made everyone used to HDWallets and one-time addresses for every transaction, giving and advantage of improved privacy.

Author, however, points out that connecting the entire HDWallet to a dApp exposes user to increased risk of compromising their seed. This risk is akin to giving the XPubKey to a third party. If a dApp will furthermore ask user to produce signatures for every single new address, the risk will increase even further. Therefore the implementation is intentionally narrowed down to reusing the single address, this way only the private key of this particular address will have more signatures produced. Key rotation on demand is advised to users.

# State of the art

The initial work has concluded in the frame of the Flipstarter (thanks again to all the supporters).

Please refer to currently supported:

* wallets: [cashonize](http://cashonize.com) ([source](https://github.com/cashonize/cashonize-wallet)), Paytaca, ZapIt.
* apps: [tapswap](https://tapswap.cash/), [wc2-web-examples](https://wc2-web-examples.vercel.app/) ([source](https://github.com/mainnet-pat/wc2-web-examples)) and others [listed](https://tokenaut.cash/dapps?filter=walletconnect)
* code snippets: [react context for wc2 and paytaca compatible wallet connector used in tapswap](./examples/react/ConnectorContext.tsx)

# Connector interface

The current interface WC2 and Paytaca-Connect use is the following.

```ts
export interface IConnector {
  address: () => Promise<string | undefined>;
  signTransaction: (options: WcSignTransactionRequest) => Promise<WcSignTransactionResponse | undefined>;
  signMessage: (options: WcSignMessageRequest) => Promise<WcSignMessageResponse | undefined>;
  connect: () => Promise<void>;
  connected: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  on(event: string, callback: Function): void;
  on(event: "addressChanged", callback: Function): void;
  on(event: "disconnect", callback: Function): void;
};
```

## signTransaction

This is a most generic interface to propose a bitcoincash transaction to a wallet which reconstructs it and signs it on behalf of the wallet user.

`options.transaction` is either a hex-encoded raw unsigned transaction, or `libauth`'s transaction object, or its stringified version produced by using `libauth`'s `stringify` function which safely serializes the normally not supported `UInt8Array`'s and `BigInt`s.

To signal that the wallet needs to sign an input, the app sets the corresponding input's `unlockingBytecode` to empty `Uint8Array`. However, wallet can also detect if a utxo belongs to the user and sign it.

In our works contract creation and interaction is based on `CashScript`. In contracts there are two user-relevant parts a signing wallet must be aware of: user's pubkey and user's signature. Both are often used in signature verfication routines and are ofthen passed as contract constructor parameters or contract function call arguments. Applications and their wallet routines prepare the transactions operating with cashaddresses, which encode pubkey hashes, not the pubkeys themselves. Hence, wallet needs to detect the pubkey placeholder and substitute it with wallet user's pubkey. We signal the use of pubkeys by using a 33-byte long zero-filled arrays and schnorr (the currently supported type) signatures by using a 65-byte long zero-filled arrays. Wallet detects these patterns and replaces them accordingly. It is unlikely that contract logic will use such specific parameters.

<details>
<summary>Click to expand `parseExtendedJson` implementation</summary>

```ts
// an extended json parser compatible with `stringify` from libauth
const parseExtendedJson = (jsonString: string) => {
  const uint8ArrayRegex = /^<Uint8Array: 0x(?<hex>[0-9a-f]*)>$/u;
  const bigIntRegex = /^<bigint: (?<bigint>[0-9]*)n>$/;

  return JSON.parse(jsonString, (_key, value) => {
    if (typeof value === "string") {
      const bigintMatch = value.match(bigIntRegex);
      if (bigintMatch) {
        return BigInt(bigintMatch[1]);
      }
      const uint8ArrayMatch = value.match(uint8ArrayRegex);
      if (uint8ArrayMatch) {
        return hexToBin(uint8ArrayMatch[1]);
      }
    }
    return value;
  });
}
```

</details>

`options.sourceOutputs` is an extended information of the UTXOs participating in this transaction, also including the user-facing contract information. Source outputs are transmitted using `libauth`'s `stringify`, since they contain `UInt8Array` and `BigInt`.

N.B. This property is currently required, but it can be made optional because this information can be recreated on the wallet side: locking and unlocking bytecodes can be obtained from Fulcrum and contract information by looking up a redeem bytecode (stripped of contract function and constructor arguments) from a specialized contract registry akin to [4byte.directory](https://www.4byte.directory).

<details>
<summary>Example</summary>

Request
```json
{
    "transaction": {
        "inputs": [
            {
                "outpointIndex": 0,
                "outpointTransactionHash": "<Uint8Array: 0x21c26767a3dcd51d370f7001e1f03bfdc40238154474190f824aa3256dd5abfa>",
                "sequenceNumber": 4294967294,
                "unlockingBytecode": "<Uint8Array: 0x00004c8603f0490214e4da17ddbe40533c2a8638fdedf2c0997d46e95314ebac52a0f55b39513be770779ba7435be7eba30d00000003404b4c5779008763c0cc78a269c0d1527988c0d2537988c0d35479a2690376a91455797e0288ac7ec0cd78880376a91457797e0288ac7e52cd788852cc59799d6d675879a955798857795979ad686d6d6d6d7551>"
            },
            {
                "outpointIndex": 1,
                "outpointTransactionHash": "<Uint8Array: 0x4f06f05cf970ba0147cfeb0e25d7f1cabc084c53dc09e514f03256ff01947957>",
                "sequenceNumber": 4294967294,
                "unlockingBytecode": "<Uint8Array: 0x>"
            }
        ],
        "locktime": 799775,
        "outputs": [
            {
                "lockingBytecode": "<Uint8Array: 0x76a914ebac52a0f55b39513be770779ba7435be7eba30d88ac>",
                "valueSatoshis": "<bigint: 5000000n>"
            },
            {
                "lockingBytecode": "<Uint8Array: 0x76a914c3a3bdec377fd2757fa25596150ea78defc14f4d88ac>",
                "token": {
                    "amount": "<bigint: 50000000000n>",
                    "category": "<Uint8Array: 0xde980d12e49999f1dbc8d61a8f119328f7be9fb1c308eafe979bf10abb17200d>"
                },
                "valueSatoshis": "<bigint: 1000n>"
            },
            {
                "lockingBytecode": "<Uint8Array: 0x76a914e4da17ddbe40533c2a8638fdedf2c0997d46e95388ac>",
                "valueSatoshis": "<bigint: 150000n>"
            },
            {
                "lockingBytecode": "<Uint8Array: 0x76a914c3a3bdec377fd2757fa25596150ea78defc14f4d88ac>",
                "valueSatoshis": "<bigint: 23051850n>"
            }
        ],
        "version": 2
    },
    "sourceOutputs": [
        {
            "outpointIndex": 0,
            "outpointTransactionHash": "<Uint8Array: 0x21c26767a3dcd51d370f7001e1f03bfdc40238154474190f824aa3256dd5abfa>",
            "sequenceNumber": 4294967294,
            "unlockingBytecode": "<Uint8Array: 0x00004c8603f0490214e4da17ddbe40533c2a8638fdedf2c0997d46e95314ebac52a0f55b39513be770779ba7435be7eba30d00000003404b4c5779008763c0cc78a269c0d1527988c0d2537988c0d35479a2690376a91455797e0288ac7ec0cd78880376a91457797e0288ac7e52cd788852cc59799d6d675879a955798857795979ad686d6d6d6d7551>",
            "lockingBytecode": "<Uint8Array: 0xa91424a309f13525a2b87cb878a769e56d3c348b8e9887>",
            "valueSatoshis": "<bigint: 1000n>",
            "token": {
                "amount": "<bigint: 50000000000n>",
                "category": "<Uint8Array: 0xde980d12e49999f1dbc8d61a8f119328f7be9fb1c308eafe979bf10abb17200d>"
            },
            "contract": {
                "abiFunction": {
                    "name": "Execute",
                    "inputs": [
                        {
                            "name": "cancelSignature",
                            "type": "bytes"
                        },
                        {
                            "name": "ownerPubKey",
                            "type": "bytes"
                        }
                    ]
                },
                "redeemScript": "<Uint8Array: 0x03f0490214e4da17ddbe40533c2a8638fdedf2c0997d46e95314ebac52a0f55b39513be770779ba7435be7eba30d00000003404b4c5779008763c0cc78a269c0d1527988c0d2537988c0d35479a2690376a91455797e0288ac7ec0cd78880376a91457797e0288ac7e52cd788852cc59799d6d675879a955798857795979ad686d6d6d6d7551>",
                "artifact": {
                    "contractName": "MarketOrder",
                    "constructorInputs": [
                        {
                            "name": "wantSats",
                            "type": "int"
                        },
                        {
                            "name": "wantCategory",
                            "type": "bytes"
                        },
                        {
                            "name": "wantNFTCommitment",
                            "type": "bytes"
                        },
                        {
                            "name": "wantFTs",
                            "type": "int"
                        },
                        {
                            "name": "ownerPubKeyHash",
                            "type": "bytes"
                        },
                        {
                            "name": "platformPubKeyHash",
                            "type": "bytes"
                        },
                        {
                            "name": "platformFee",
                            "type": "int"
                        }
                    ],
                    "abi": [
                        {
                            "name": "Execute",
                            "inputs": [
                                {
                                    "name": "cancelSignature",
                                    "type": "bytes"
                                },
                                {
                                    "name": "ownerPubKey",
                                    "type": "bytes"
                                }
                            ]
                        }
                    ],
                    "compiler": {
                        "name": "cashc",
                        "version": "0.8.0-next.4"
                    },
                    "updatedAt": "2023-06-30T16:12:58.887Z"
                }
            }
        },
        {
            "outpointIndex": 1,
            "outpointTransactionHash": "<Uint8Array: 0x4f06f05cf970ba0147cfeb0e25d7f1cabc084c53dc09e514f03256ff01947957>",
            "sequenceNumber": 4294967294,
            "unlockingBytecode": "<Uint8Array: 0x>",
            "lockingBytecode": "<Uint8Array: 0x76a914c3a3bdec377fd2757fa25596150ea78defc14f4d88ac>",
            "valueSatoshis": "<bigint: 28202359n>"
        }
    ],
    "broadcast": false,
    "userPrompt": "Sign transaction to buy token"
}
```

Response:

```json
{
  "signedTransaction": "0200000002faabd56d25a34a820f197434153802c4fd3bf0e101700f371dd5dca36767c221000000008a00004c8603f0490214e4da17ddbe40533c2a8638fdedf2c0997d46e95314ebac52a0f55b39513be770779ba7435be7eba30d00000003404b4c5779008763c0cc78a269c0d1527988c0d2537988c0d35479a2690376a91455797e0288ac7ec0cd78880376a91457797e0288ac7e52cd788852cc59799d6d675879a955798857795979ad686d6d6d6d7551feffffff57799401ff5632f014e509dc534c08bccaf1d7250eebcf4701ba70f95cf0064f0100000064419640dc7cf8f5d548cf278d3ff80592a9422b8ff8d7adf90ad144a8332c79baf07c5deb9a1e20176868df60a74ab3ccf5a63de2b5c7cd118d84fc15690d198cd841210365fa25262083bb13dde0408dff2b7545534fe143738d236a1e0eaeef5f31accdfeffffff04404b4c00000000001976a914ebac52a0f55b39513be770779ba7435be7eba30d88ace80300000000000044ef0d2017bb0af19b97feea08c3b19fbef72893118f1ad6c8dbf19999e4120d98de10ff00743ba40b00000076a914c3a3bdec377fd2757fa25596150ea78defc14f4d88acf0490200000000001976a914e4da17ddbe40533c2a8638fdedf2c0997d46e95388ac4abe5f01000000001976a914c3a3bdec377fd2757fa25596150ea78defc14f4d88ac1f340c00",
  "signedTransactionHash": "532336dc9daae6ac02c83cad058a1bd9729e1656b921692ec3997a10cfadb8af"
}
```

</details>

`options.broadcast` Defaults to true. An optional flag which instructs to immediately broadcast the transaction after signing. Application side wallet which prepared the unsigned transaction might want to broadcast it and track the node response itself.

`options.userPrompt` is an optional message to present to user in wallet's transaction signing interface.

Response:

`signedTransaction` hex encoded raw signed transaction ready to be submitted to a node.

`signedTransactionHash` hex encoded transaction hash of the `signedTransaction` can be used by the application to track if it was rejected or included into mempool.

<details>
<summary>Show interfaces</summary>

```ts
export interface ContractInfo {
  contract?: {
    abiFunction: AbiFunction;
    redeemScript: Uint8Array;
    artifact: Partial<Artifact>;
  }
}

export interface AbiInput {
  name: string;
  type: string;
}

export interface AbiFunction {
  name: string;
  inputs: readonly AbiInput[];
}

export interface Artifact {
  contractName: string;
  constructorInputs: readonly AbiInput[];
  abi: readonly AbiFunction[];
  bytecode: string;
  source: string;
  compiler: {
    name: string;
    version: string;
  }
  updatedAt: string;
}

export type WcSourceOutput = Input & Output & ContractInfo;

export interface WcSignTransactionRequest {
  transaction: Transaction | string;
  sourceOutputs: WcSourceOutput[];
  broadcast?: boolean;
  userPrompt?: string;
}

export interface WcSignTransactionResponse {
  signedTransaction: string;
  signedTransactionHash: string;
}

export interface WcSignMessageRequest {
  message: string;
  userPrompt?: string;
}

export type WcSignMessageResponse = string;
```

</details>

## signMessage

Signs a text message using currently connected address.

This method uses the signing with `\x18Bitcoin Signed Message:\n` prefix, not exactly the message passed. This method is compatible with Electron Cash signing.

Params:

`options.message` is the message to sign. Required.

`options.userPrompt` is an optional message to present to user in wallet's transaction signing interface.

Response: Base64 encoded signed message

<details>
<summary>Show interfaces</summary>

Request:

```json
{
    "message": "05010000004254"
}
```

Response

```text
H+/mEEddfIuC8h+g/qXOmKsW0MGikLQNZ3Q2r8OGGxO4eKDBL3v5fhWt0Sh5UWNxDRyvHj4PAqUS/DkQoartLbc=
```

</details>

# WalletConnect

WC2 communication FAQ.

## Creating a communication client with `Sign` API

```ts
import Client from "@walletconnect/sign-client";

const client = await Client.init({
  logger: "debug", // debug log level, optional
  relayUrl: "wss://relay.walletconnect.com", // optional, this is the default value
  projectId: "3fd234b8e2cd0e1da4bc08a0011bbf64", // required
  metadata: {
    name: "TapSwap.cash",
    description: "TapSwap Cashtokens Marketplace",
    url: "https://tapswap.cash/",
    icons: ["https://tapswap.cash/favicon.ico"],
  }
});
```

## Pairing

Pairing is the initial handshake between a wallet and an app. It allows to establish and restore sessions.

To establish a pairing an app should define its requested the authorization scope. Several different chains and methods could be provided. In our case:

```ts
const requiredNamespaces = {
  "bch": {
      "chains": [
          "bch:bitcoincash"
      ],
      "methods": [
          "bch_getAddresses",
          "bch_signTransaction",
          "bch_signMessage"
      ],
      "events": [
          "addressesChanged"
      ]
  }
};
```

`chains` property defined in `CAIP-2` format.

* `bch:bitcoincash` is used for BCH mainnet
* `bch:bchtest` is used for BCH testnet
* `bch:bchreg` is used for BCH regtest

## Session

To create a new session use the following code

```ts
// `uri` is the WC2 uri to be pasted into wallets or presented as QR Code
// `approval` is an async function to initiate and wait for the confirmation or rejection of the pairing
const { uri, approval } = await this.client.connect({
  pairingTopic: pairing?.topic, // optional
  requiredNamespaces,
});

const session = await approval();
```

To restore a session, reestablish the event subscriptions and simply continue messaging with persisted session topic. See `client.session.get`.

## Making requests

To request the connected wallet to respond to a call, use the following code:

```ts
const result = await this.client!.request<string[]>({
  chainId: this.chains[0],
  topic: this.session!.topic,
  request: {
    method: "bch_getAddresses",
    params: {},
  },
});

console.log(result);
// ["bitcoincash:qrp6800vxalayatl5f2ev9gw57x7ls20f5prjcd7vf"]
```

All other request interfaces are compatible with the described `IConnector` interface described above, formatted in `bch_${methodName}`.

# Possible features

## sendTransaction

The specification and implementation of a simplified `bch_sendTransaction` method is advised to be established. Instead of generic and somewhat complicated `bch_signTransaction` a further interface can be used:

```ts
export interface IConnector {
  // ...
  sendTransaction: (options: { recipientCashaddress: string, valueSatoshis: bigint, broadcast?: boolean, userPrompt?: string }) => Promise<WcSignTransactionResponse>;
  // ...
}
```

## batchSignTransaction

Complex application workflows might require to consequitively sign several transactions. An example could be minting 3 NFTs from a single threaded covenant like the one used in BitCats. Another example is a relisting of a sell order at higher price on TapSwap which normally requires two transactions: first to cancel the order listing and second to create a new listing contract with modified price. Batching such chain of interactions will greatly improve the user experience by sparing them switching between the app and the wallet multiple times.

```ts
export interface IConnector {
  // ...
  batchSignTransaction: (options: { transactionsTemplates: [{transaction: string | TransactionBCH, sourceOutputs: WcSourceOutput[] }], broadcast?: boolean, userPrompt?: string }) => Promise<Array<WcSignTransactionResponse>>;
  // ...
}
```

# Implementation

See the [monorepo](https://github.com/mainnet-pat/bch-wc2) which has typescript interfaces and private key signer which helps with local development and automated testing.
