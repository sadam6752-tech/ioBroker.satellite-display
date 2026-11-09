// This file extends the AdapterConfig type from "@iobroker/types"
// using the actual properties present in io-package.json
// in order to provide typings for adapter.config properties

import { native } from '../io-package.json';

// the tables are empty in io-package.json, so their row types are declared here
type _AdapterConfig = Omit<typeof native, 'satellites' | 'tiles'> & {
    satellites: Array<Record<string, any>>;
    tiles: Array<Record<string, any>>;
};

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig extends _AdapterConfig {
            // Do not enter anything here!
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
