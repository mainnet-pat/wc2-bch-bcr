import Client from "@walletconnect/sign-client";
import { getAppMetadata, getSdkError } from "@walletconnect/utils";
import { PairingTypes, SessionTypes } from "@walletconnect/types";
import { TransactionBCH, Input, Output, stringify } from "@bitauth/libauth";
import { Web3Modal } from "@web3modal/standalone";
import EventEmitter from "events";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AbiFunction, Artifact } from "cashscript";

/**
 * Types
 */
export interface IContext {
  connector: IConnector | undefined;
  active: boolean;
  address: () => Promise<string | undefined>;
  signTransaction: (options: {transaction: string | TransactionBCH, sourceOutputs: (Input | Output | ContractInfo)[], broadcast?: boolean, userPrompt?: string}) => Promise<{ signedTransaction: string, signedTransactionHash: string} | undefined>;
  signMessage: (options: {message: string, userPrompt?: string}) => Promise<string | undefined>;
  connect: (connectorType: ConnectorType) => Promise<void>;
  connected: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  on(event: string, callback: Function): void;
  on(event: "addressChanged", callback: Function): void;
  on(event: "disconnect", callback: Function): void;
}

export type ConnectorType = "WalletConnectV2" | "Paytaca" | null;

/**
 * Context
 */
export const ConnectorContext = createContext<IContext>({} as IContext);

export interface ContractInfo {
  contract?: {
    abiFunction: AbiFunction;
    redeemScript: Uint8Array;
    artifact: Partial<Artifact>;
  }
}

export interface IConnector {
  address: () => Promise<string | undefined>;
  signTransaction: (options: {transaction: string | TransactionBCH, sourceOutputs: (Input | Output | ContractInfo)[], broadcast?: boolean, userPrompt?: string}) => Promise<{ signedTransaction: string, signedTransactionHash: string} | undefined>;
  signMessage: (options: {message: string, userPrompt?: string}) => Promise<string | undefined>;
  connect: () => Promise<void>;
  connected: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  on(event: string, callback: Function): void;
  on(event: "addressChanged", callback: Function): void;
  on(event: "disconnect", callback: Function): void;
};

// paytaca
export class PaytacaConnector implements IConnector {
  async address(): Promise<string | undefined> {
    return window.paytaca!.address();
  };
  async signTransaction(options: { transaction: string | TransactionBCH; sourceOutputs: (Input<Uint8Array, Uint8Array> | Output<Uint8Array, Uint8Array> | ContractInfo)[]; broadcast?: boolean; userPrompt?: string | undefined; }): Promise<{ signedTransaction: string, signedTransactionHash: string} | undefined> {
    return window.paytaca!.signTransaction(options);
  };
  async signMessage(options: { message: string; userPrompt?: string | undefined; }): Promise<string | undefined> {
    return window.paytaca!.signMessage(options);
  };
  async connect(): Promise<void> {
    return new Promise(async (resolve) => {
      if (!await this.connected()) {
        window.paytaca!.on("addressChanged", () => {
          resolve();
        });
        window.paytaca!.connect();
      } else {
        resolve();
      }
    })
  };
  async connected(): Promise<boolean> {
    return window.paytaca!.connected();
  };
  async disconnect(): Promise<void> {
    return window.paytaca!.disconnect();
  };
  on(event: string, callback: Function): void {
    return window.paytaca!.on(event, callback);
  };
}

// walletconnect 2
export const DEFAULT_PROJECT_ID = process.env.NEXT_PUBLIC_PROJECT_ID;
export const DEFAULT_RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL;

// export const DEFAULT_LOGGER = "debug";
export const DEFAULT_LOGGER = undefined;

export const DEFAULT_APP_METADATA = {
  name: "TapSwap.cash",
  description: "TapSwap Cashtokens Marketplace",
  url: "https://tapswap.cash/",
  icons: ["https://tapswap.cash/favicon.ico"],
};

const desktopWallets = [{
  id: "Cashonize",
  name: "Cashonize",
  links: {
    native: undefined as any,
    universal: "https://cashonize.com/#/wc"
  },
},
{
  id: "Paytaca",
  name: "Paytaca",
  links: {
    native: "",
    universal: "chrome-extension://pakphhpnneopheifihmjcjnbdbhaaiaa/www/index.html#/apps/wallet-connect"
  }
},
{
  id: "Zapit",
  name: "Zapit",
  links: {
    native: "",
    universal: "chrome-extension://fccgmnglbhajioalokbcidhcaikhlcpm/index.html#/wallet-connect"
  }
},
];

const web3Modal = new Web3Modal({
  projectId: undefined as any,
  walletConnectVersion: 2,
  desktopWallets: desktopWallets,
  walletImages: {
    "Cashonize": "https://cashonize.com/images/cashonize-icon.png",
    "Paytaca": "https://www.paytaca.com/favicon.png",
    "Zapit": "https://lh3.googleusercontent.com/DbMYirtFPzZhSky0djg575FGPAriqGUPokFcb8r0-3qdcgKfR8uLqwK0DCPn0XrrsijRNDUAKUVLXGqLWVcFBB8zDA=s120",
  },
  enableExplorer: false,
  enableAccountView: true,
  mobileWallets: [],
  explorerRecommendedWalletIds: "NONE",
});

const globalClient = await Client.init({
  logger: DEFAULT_LOGGER,
  relayUrl: DEFAULT_RELAY_URL!,
  projectId: DEFAULT_PROJECT_ID,
  metadata: DEFAULT_APP_METADATA || getAppMetadata(),
});

export class WalletConnect2Connector implements IConnector {
  client?: Client;
  pairings: PairingTypes.Struct[] = [];
  session?: SessionTypes.Struct = undefined;
  prevRelayerValue: string = "";
  accounts: string[] = [];
  chains: string[] = [];
  relayerRegion: string = DEFAULT_RELAY_URL!;
  events: EventEmitter = new EventEmitter();

  constructor() {
  };

  reset() {
    this.session = undefined;
    this.accounts = [];
    this.chains = [];
    this.relayerRegion = DEFAULT_RELAY_URL!;
    this.client?.removeAllListeners(undefined as any);
  };

  async onSessionConnected(_session: SessionTypes.Struct) {
    const allNamespaceAccounts = Object.values(_session.namespaces)
      .map((namespace) => namespace.accounts)
      .flat();

    this.session = _session;
    this.chains = ["bch:bitcoincash"];
    this.accounts = allNamespaceAccounts;
  }

  async _subscribeToEvents(_client: Client) {
    if (typeof _client === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    _client.on("session_ping", (args) => {
      DEFAULT_LOGGER && console.log("EVENT", "session_ping", args);
    });

    _client.on("session_event", (args) => {
      DEFAULT_LOGGER && console.log("EVENT", "session_event", args);
      const params = args.params;
      if (params.chainId !== this.chains[0]) {
        return;
      }

      this.events.emit(params.event.name, params.event.data);
    });

    _client.on("session_update", ({ topic, params }) => {
      DEFAULT_LOGGER && console.log("EVENT", "session_update", { topic, params });
      const { namespaces } = params;
      const _session = _client.session.get(topic);
      const updatedSession = { ..._session, namespaces };
      this.onSessionConnected(updatedSession);
    });

    _client.on("session_delete", (args) => {
      DEFAULT_LOGGER && console.log("EVENT", "session_delete");
      this.events.emit("disconnect", args);
      _client.pairing.keys.forEach(key => {
        _client.pairing.delete(key, getSdkError("USER_DISCONNECTED"));
      });
      this.reset();
    });
  };

  async _checkPersistedState(_client: Client) {
    if (typeof _client === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }
    // populates existing pairings to state
    this.pairings = _client.pairing.getAll({ active: true });
    DEFAULT_LOGGER && console.log(
      "RESTORED PAIRINGS: ",
      _client.pairing.getAll({ active: true })
    );

    if (typeof this.session !== "undefined") return;
    // populates (the last) existing session to state
    if (_client.session.length) {
      const lastKeyIndex = _client.session.keys.length - 1;
      const _session = _client.session.get(
        _client.session.keys[lastKeyIndex]
      );
      DEFAULT_LOGGER && console.log("RESTORED SESSION:", _session);
      await this.onSessionConnected(_session);
      return _session;
    }
  };

  async address(): Promise<string | undefined> {
    try {
      const result = await this.client!.request<string[]>({
        chainId: this.chains[0],
        topic: this.session!.topic,
        request: {
          method: "bch_getAddresses",
          params: {},
        },
      });

      return result[0];
    } catch (error: any) {
      return undefined;
    }
  };

  async signTransaction(options: { transaction: string | TransactionBCH; sourceOutputs: (Input<Uint8Array, Uint8Array> | Output<Uint8Array, Uint8Array> | ContractInfo)[]; broadcast?: boolean; userPrompt?: string | undefined; }): Promise<{ signedTransaction: string, signedTransactionHash: string} | undefined> {
    try {
      const result = await this.client!.request<{ signedTransaction: string, signedTransactionHash: string}>({
        chainId: this.chains[0],
        topic: this.session!.topic,
        request: {
          method: "bch_signTransaction",
          params: JSON.parse(stringify(options)),
        },
      });

      return result;
    } catch (error: any) {
      return undefined;
    }
  };

  async signMessage(options: { message: string; userPrompt?: string | undefined; }): Promise<string | undefined> {
    try {
      const result = await this.client!.request<string>({
        chainId: this.chains[0],
        topic: this.session!.topic,
        request: {
          method: "bch_signMessage",
          params: options,
        },
      });

      return result;
    } catch (error: any) {
      return undefined;
    }
  };

  async connect(): Promise<void> {
    this.client = globalClient;

    this.prevRelayerValue = this.relayerRegion;
    await this._subscribeToEvents(this.client);
    await this._checkPersistedState(this.client);

    if (!this.session) {
      const pairings = this.client.pairing.getAll({ active: true });
      this.pairings = pairings;

      await this._connect(pairings[0]);
    }
  };

  async _connect(pairing: any) {
    if (typeof this.client === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }
    DEFAULT_LOGGER && console.log("connect, pairing topic is:", pairing?.topic);
    try {
      const requiredNamespaces = {
        "bch": {
            "methods": [
                "bch_getAddresses",
                "bch_signTransaction",
                "bch_signMessage"
            ],
            "chains": [
                "bch:bitcoincash"
            ],
            "events": [
                "addressesChanged"
            ]
        }
      };
      DEFAULT_LOGGER && console.log(
        "requiredNamespaces config for connect:",
        requiredNamespaces
      );

      const { uri, approval } = await this.client.connect({
        pairingTopic: pairing?.topic,
        requiredNamespaces,
      });

      // Open QRCode modal if a URI was returned (i.e. we're not connecting an existing pairing).
      if (uri) {
        // Create a flat array of all requested chains across namespaces.
        const standaloneChains = Object.values(requiredNamespaces)
          .map((namespace) => namespace.chains)
          .flat() as string[];

        web3Modal.openModal({ uri, standaloneChains });
      }

      const session = await approval();
      DEFAULT_LOGGER && console.log("Established session:", session);
      await this.onSessionConnected(session);
      // Update known pairings after session is connected.
      this.pairings = this.client.pairing.getAll({ active: true });
    } catch (e) {
      console.error(e);
      // ignore rejection
    } finally {
      // close modal in case it was open
      web3Modal.closeModal();
    }
  }

  async connected(): Promise<boolean> {
    return this.client !== undefined && this.session !== undefined;
  };
  async disconnect(): Promise<void> {
    if (typeof this.client === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }
    if (typeof this.session === "undefined") {
      throw new Error("Session is not connected");
    }

    try {
      await this.client.disconnect({
        topic: this.session.topic,
        reason: getSdkError("USER_DISCONNECTED"),
      });
      this.client.pairing.keys.forEach(key => {
        this.client!.pairing.delete(key, getSdkError("USER_DISCONNECTED"));
      });
    } catch (error) {
      DEFAULT_LOGGER && console.error("SignClient.disconnect failed:", error);
    } finally {
      // Reset app state after disconnect.
      this.reset();
    }
  };
  on(event: string, callback: Function): void {
    this.events.on(event, callback as any);
  }
}

/**
 * Provider
 */
export function ConnectorContextProvider({
  children,
}: {
  children: ReactNode | ReactNode[];
}) {
  const [connectorType, setConnectorType] = useState<ConnectorType>();
  const [connector, setConnector] = useState<IConnector>();
  const [active, setActive] = useState<boolean>(false);

  const connect = useCallback(async (type: ConnectorType) => {
    if (connectorType === type) {
      return;
    }

    const connector = createConnector(type);
    if (!connector) {
      return;
    }

    await connector!.connect();
    setConnectorType(type);
    setConnector(connector);
    localStorage.setItem("Connector", type as any);
    setActive(true);

    connector.on("disconnect", async () => {
      localStorage.removeItem("Connector");
      setActive(false);
      setConnector(undefined);
      setConnectorType(undefined);
    });
  }, [setConnector, connector, setConnectorType, connectorType, setActive]);

  const connected = useCallback(() => {
    return connector!.connected();
  }, [connector]);

  const disconnect = useCallback(async () => {
    await connector!.disconnect();
    localStorage.removeItem("Connector");
    setActive(false);
    setConnector(undefined);
    setConnectorType(undefined);
  }, [connector, setActive, setConnector, setConnectorType]);

  const address = useCallback(() => {
    return connector!.address();
  }, [connector]);

  const signTransaction = useCallback((options: {transaction: string | TransactionBCH, sourceOutputs: (Input | Output | ContractInfo)[], broadcast?: boolean, userPrompt?: string}): Promise<{ signedTransaction: string, signedTransactionHash: string} | undefined> => {
    return connector!.signTransaction(options);
  }, [connector]);

  const signMessage = useCallback((options: {message: string, userPrompt?: string}): Promise<string | undefined> => {
    return connector!.signMessage(options);
  }, [connector]);

  const on = useCallback((event: string, callback: Function): void => {
    return connector!.on(event, callback);
  }, [connector]);

  const createConnector = (connectorType: ConnectorType) => {
    if (connectorType === "Paytaca") {
      return new PaytacaConnector();
    } else if (connectorType === "WalletConnectV2") {
      return new WalletConnect2Connector();
    }
  }

  useEffect(() => {
    connect(localStorage.getItem("Connector") as any);
  }, [connect]);

  const value = useMemo(
    () => ({
      connector,
      active,
      connect,
      connected,
      disconnect,
      address,
      on,
      signMessage,
      signTransaction,
    }),
    [
      connector,
      active,
      connect,
      connected,
      disconnect,
      address,
      on,
      signMessage,
      signTransaction,
    ]
  );

  return (
    <ConnectorContext.Provider
      value={{
        ...value,
      }}
    >
      {children}
    </ConnectorContext.Provider>
  );
}

export function useConnectorContext() {
  const context = useContext(ConnectorContext);
  if (context === undefined) {
    throw new Error(
      "usePaytacaContext must be used within a ConnectorContextProvider"
    );
  }
  return context;
}
