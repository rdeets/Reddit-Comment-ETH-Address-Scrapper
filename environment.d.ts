declare global {
	namespace NodeJS {
		interface ProcessEnv {
			ACCESS_TOKEN: String;
			ACCESS_TOKEN_SECRET: String;
			CONSUMER_KEY: String;
			CONSUMER_SECRET: String;
			environment: 'dev' | 'prod' | 'debug';
		}
	}
}

export {};
