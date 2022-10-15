require('dotenv').config();
import { launch } from 'puppeteer';
import fs from 'fs';
import readline from 'readline';
import { log } from 'console-styling';
import { utils, providers } from 'ethers';
import axios from 'axios';
import jsdom from 'jsdom';

interface AddressEntries {
	userId: string;
	balance: number;
	url: string;
}

interface Comment {
	text: string;
	url: string;
	userId: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

log(
	'------REDDIT ETH ADDRESS SCRAPPER------\n\n by Ryan Deets\n\nhttps://github.com/rdeets/\n',
	{ color: 'magenta' }
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

	async function multiPageScrape(url: string) {
		try {
			log('Scrapping ' + url, { preset: 'info' });
			const dom = new jsdom.JSDOM(
				(await axios.get(url.replace('www.', 'old.'))).data
			);
			const document = dom.window.document;

			await page.goto(url.replace('www.', 'old.'));

			const pageUrls = await page.evaluate(() => {
				return Array.from(document.links).map((link: any) => link.href);
			});
			const commentArray = [
				...new Set(pageUrls.filter((link: any) => link.includes('/comments/')))
			];
			const nextPage = pageUrls.find((link) => link.includes('/?count=25'));

			let oldAddressSize = ethAddresses.size;
			for (const page of commentArray) {
				await scrapePage(page);
				if (oldAddressSize < ethAddresses.size) {
					saveFile(ethAddresses, 'ethAddresses');
					oldAddressSize = ethAddresses.size;
				}
			}

			log('pausing for 3 seconds');
			await sleep(3000);
			nextPage && multiPageScrape(nextPage);
		} catch (error) {
			log(error, { preset: 'error' });
		}
	}

	async function scrapePage(url: string) {
		log('Scrapping: ' + url, { preset: 'info' });
		await page.goto(url.replace('www.', 'old.'));
		await page.$$('.morecomments');
		const comments = await page.$$('.entry');
		const formattedComments: Comment[] = [];

		comments.forEach(async (comment) => {
			// scrape points
			const [points, author, rawText] = await Promise.all([
				comment.$eval('.score', (el: any) => el.textContent).catch(() => {}), //no score
				comment.$eval('.author', (el: any) => el.textContent).catch(() => {}), //no text
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
		});

		formattedComments.forEach(async ({ text, url, userId }: Comment) => {
			const ethAddress = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
			ethAddress &&
				ethAddresses.set(ethAddress, {
					userId,
					balance: +utils.formatEther(await provider.getBalance(ethAddress)),
					url
				});
		});
	}

	// Make 'export' directory if it doesn't exist
	!fs.existsSync('./export') && fs.mkdirSync('./export');

	try {
		const choice = await prompt(
			'\n1. Scrape Single Reddit Page\n2. Scrape Subreddit\n3. Filter Addresses\nChoose number: '
		);
		if (choice == '1') {
			await searchQuery();
		} else if (choice == '2') {
			let urlInput = '';
			urlInput = await prompt('\nEnter subreddit url\n->: ');
			await multiPageScrape(urlInput);
			ethAddresses.size > 0 && saveFile(ethAddresses, 'ethAddresses');
		} else if (choice == '3') return await filterAddresses();
	} catch (error) {
		log('Unable to get page: ' + error, {
			preset: 'error'
		});
	}
	await browser.close();
})();
