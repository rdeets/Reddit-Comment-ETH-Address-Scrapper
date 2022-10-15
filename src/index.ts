require('dotenv').config();
import { launch } from 'puppeteer';
import fs from 'fs';
import readline from 'readline';
import { log } from 'console-styling';
import { utils, providers } from 'ethers';
import axios from 'axios';
import { JSDOM } from 'jsdom';

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
	'------REDDIT ETH ADDRESS SCRAPPER------\n\nBy Ryan Deets\n\nhttps://github.com/rdeets/\n',
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
			urlInput = await prompt('\nEnter content or URL (q to exit)\n->: ');
			if (urlInput == 'q') break;

			await scrapePage(urlInput);
			saveFile(ethAddresses, 'ethAddresses');
		}
	}

	async function multiPageScrape(url: string) {
		try {
			log('Scrapping ' + url, { preset: 'info' });
			const dom = new JSDOM(
				(await axios.get(url.replace('www.', 'old.'))).data
			);
			const document = dom.window.document;

			await page.goto(url.replace('www.', 'old.'), {
				waitUntil: 'domcontentloaded'
			});

			const pageUrls = await page.evaluate(() => {
				return Array.from(document.links).map((link: any) => link.href);
			});
			const commentArray = pageUrls.filter((link: any) =>
				link.includes('/comments/')
			);
			const pageLinks: string[] = pageUrls.filter((link) =>
				link.includes('/?count=')
			);
			const nextPage = pageLinks[pageLinks.length - 2] ?? pageLinks[0];
			const uniqueUrlArray = [...new Set(commentArray)];

			let old = ethAddresses.size;
			for (const page of uniqueUrlArray) {
				await scrapePage(page);
				if (old < ethAddresses.size) {
					saveFile(ethAddresses, 'ethAddresses');
					old = ethAddresses.size;
				}
			}

			log('Pausing for 3 seconds');
			await sleep(3000);
			nextPage && (await multiPageScrape(nextPage));
		} catch (error) {
			log(error, { preset: 'error' });
		}
	}

	async function scrapePage(url: string) {
		log('scrapping: ' + url, { preset: 'info' });
		await page.goto(url.replace('www.', 'old.'), {
			waitUntil: 'domcontentloaded'
		});
		await page.$$('.morecomments');
		const comments = await page.$$('.entry');
		const formattedComments: Comment[] = [];
		for (const comment of comments) {
			// scrape points
			const [points, author, rawText] = await Promise.all([
				comment.$eval('.score', (el: any) => el.textContent).catch(() => {}), //no score
				comment.$eval('.author', (el: any) => el.textContent).catch(() => {}), //no author
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
		switch (
			await prompt(
				'\n1. Scrape Single Reddit Page\n2. Scrape Subreddit\n3. Filter Addresses\nChoose number: '
			)
		) {
			case '1':
				await searchQuery();
				break;
			case '2':
				await multiPageScrape(await prompt('\nEnter subreddit url\n->: '));
				break;
			case '3':
				await filterAddresses();
				break;
			default:
				log('Invalid entry', { preset: 'error' });
		}
	} catch (error) {
		log('Unable to get page: ' + error, {
			preset: 'error'
		});
	}
	await browser.close();
})();
