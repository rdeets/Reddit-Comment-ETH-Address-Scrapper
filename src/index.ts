require('dotenv').config();
import { launch } from 'puppeteer';
import fs from 'fs';
import readline from 'readline';
import { log } from 'console-styling';
import { utils, providers } from 'ethers';

interface AddressEntries {
	userId: string;
	balance: number;
	url: string;
}

function fetchFile<T>(name: string) {
	return new Map<string, T>(
		fs.existsSync(`./export/${name}.json`)
			? Object.entries(
					JSON.parse(fs.readFileSync(`./export/${name}.json`, 'utf8') || '{}')
			  )
			: Object.entries({})
	);
}

function saveFile(data: Map<string, any>, name: string) {
	fs.writeFile(
		`./export/${name}.json`,
		JSON.stringify(Object.fromEntries(data)),
		(err) => {
			if (err) throw err;
			log(`${data.size} entries saved to /export/${name}.json`, {
				preset: 'success'
			});
		}
	);
}

console.log(
	'------REDDIT ETH ADDRESS SCRAPPER------\n\n by Ryan Deets\n\nhttps://github.com/rdeets/\n'
);

(async () => {
	const ethAddresses: Map<string, AddressEntries> = fetchFile('ethAddresses');
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	const provider = new providers.JsonRpcProvider(process.env.ETH_ENDPOINT);
	const browser = await launch();
	const page = await browser.newPage();

	function prompt(query: string) {
		return new Promise<string>((resolve) => rl.question(query, resolve));
	}

	async function filterAddresses() {
		const filteredAddresses: Map<string, AddressEntries> = new Map();
		const minBalance = +(await prompt('Minimum ETH balance: '));
		ethAddresses.forEach((addressEntry, address) => {
			addressEntry.balance >= minBalance &&
				filteredAddresses.set(address, addressEntry);
		});
		saveFile(filteredAddresses, 'filteredAddresses');
	}

	async function searchQuery() {
		let urlInput = '';
		while (true) {
			urlInput = await prompt(
				'\nEnter content or URL (q to exit) (s to save)\n->: '
			);
			if (urlInput == 'q' || urlInput == 's') {
				break;
			}
			await scrapePage(urlInput);
		}
		ethAddresses.size > 0 && saveFile(ethAddresses, 'ethAddresses');
		if (urlInput == 's') await searchQuery();
	}

	async function scrapePage(url: string) {
		await page.goto(url.replace('www.', 'old.'));
		await page.$$('.morecomments');
		const comments = await page.$$('.entry');
		const formattedComments = [];

		for (const comment of comments) {
			// scrape points
			const [points, author, rawText] = await Promise.all([
				comment.$eval('.score', (el: any) => el.textContent).catch(() => {}), //no score
				comment.$eval('.author', (el: any) => el.textContent).catch(() => {}), //no score
				// scrape texts
				comment
					.$eval('.usertext-body', (el: any) => el.textContent)
					.catch(() => {}) //no text
			]);
			if (points && rawText)
				formattedComments.push({
					text: rawText.replace(/\n/g, ''),
					url,
					userId: author
				});
		}

		formattedComments.forEach(
			async ({
				text,
				url,
				userId
			}: {
				text: string;
				url: string;
				userId: string;
			}) => {
				const ethAddress = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
				ethAddress &&
					ethAddresses.set(ethAddress, {
						userId,
						balance: +utils.formatEther(await provider.getBalance(ethAddress)),
						url
					});
			}
		);
		log(`${ethAddresses.size} Total ETH Addresses`, {
			preset: 'info'
		});
	}

	// Make 'export' directory if it doesn't exist
	!fs.existsSync('./export') && fs.mkdirSync('./export');

	try {
		const choice = await prompt(
			'\n1. Scrape Reddit\n2. Filter Addresses\nChoose number: '
		);
		if (choice == '2') return await filterAddresses();

		await searchQuery();
	} catch (error) {
		log('Unable to get page: ' + error, {
			preset: 'error'
		});
	}
	await browser.close();
})();
