#!/usr/bin/env node

const puppeteer = require('puppeteer');
const parseUrl = require('url-parse');
const fileUrl = require('file-url');
const isUrl = require('is-url');
const fs = require('fs');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// common options for both print and screenshot commands
const commonOptions = {
    'sandbox': {
        boolean: true,
        default: false
    },
    'timeout': {
        default: 30 * 1000,
        number: true,
    },
    'wait-until': {
        string: true,
        default: 'load'
    },
    'cookie': {
        describe: 'Set a cookie in the form "key:value". May be repeated for multiple cookies.',
        type: 'string'
    }
};

const argv = require('yargs')
    .command({
        command: 'bulk-print <batchFile>',
        builder: {
            ...commonOptions,
            'background': {
                boolean: true,
                default: true
            },
            'margin-top': {
                default: '6.25mm'
            },
            'margin-right': {
                default: '6.25mm'
            },
            'margin-bottom': {
                default: '14.11mm'
            },
            'margin-left': {
                default: '6.25mm'
            },
            'format': {
                default: 'A4'
            },
        },
        handler: async argv => {
            try {
                await bulkPrint(argv);
            } catch (err) {
                console.log('Failed to generate pdf:', err);
                process.exit(1);
            }
        }
    })
    .command({
        command: 'print <url> [output]',
        desc: 'Print an HTML file or URL to PDF',
        builder: {
            ...commonOptions,
            'background': {
                boolean: true,
                default: true
            },
            'margin-top': {
                default: '6.25mm'
            },
            'margin-right': {
                default: '6.25mm'
            },
            'margin-bottom': {
                default: '14.11mm'
            },
            'margin-left': {
                default: '6.25mm'
            },
            'format': {
                default: 'Letter'
            },
            'landscape': {
                boolean: true,
                default: false
            },
            'display-header-footer': {
                boolean: true,
                default: false
            },
            'header-template': {
                string: true,
                default: ''
            },
            'footer-template': {
                string: true,
                default: ''
            }
        },
        handler: async argv => {
            try {
                await print(argv);
            } catch (err) {
                console.log('Failed to generate pdf:', err);
                process.exit(1);
            }
        }
    }).command({
        command: 'screenshot <url> [output]',
        desc: 'Take screenshot of an HTML file or URL to PNG',
        builder: {
            ...commonOptions,
            'full-page': {
                boolean: true,
                default: true
            },
            'omit-background': {
                boolean: true,
                default: false
            },
            'viewport': {
                describe: 'Set viewport to a given size, e.g. 800x600',
                type: 'string'
            }
        },
        handler: async argv => {
            try {
                await screenshot(argv);
            } catch (err) {
                console.log('Failed to take screenshot:', err);
                process.exit(1);
            }
        }
    })
    .demandCommand()
    .help()
    .argv;


async function bulkPrint(argv) {
    let rawdata = fs.readFileSync(argv.batchFile);
    let config = JSON.parse(rawdata)["data"];

    const browser = await puppeteer.launch(buildLaunchOptions(argv));
    const page = await browser.newPage();
    for (const pdf of config) {
        const htmlFile = fileUrl(pdf["htmlFile"]);
        const pdfFile = pdf["tmpPDFFile"];

        await page.goto(htmlFile, buildNavigationOptions(argv));

        const displayFooter = !!pdf["pdfObject"]["footerTemplate"];
        const buffer = await page.pdf({
            path: pdfFile,
            format: argv.format,
            landscape: pdf["pdfObject"]["isLandscape"],
            printBackground: true,
            margin: {
                top: argv.marginTop,
                right: argv.marginRight,
                bottom: displayFooter ? pdf["pdfObject"]["footerHeight"] : argv.marginBottom,
                left: argv.marginLeft
            },
            displayHeaderFooter: displayFooter,
            footerTemplate: pdf["pdfObject"]["footerTemplate"].replace(new RegExp('\\\\\"', 'g'),'"')
        });
        await sleep(20);
    }

    await browser.close();
}

async function print(argv) {
    const browser = await puppeteer.launch(buildLaunchOptions(argv));
    const page = await browser.newPage();
    const url = isUrl(argv.url) ? parseUrl(argv.url).toString() : fileUrl(argv.url);

    if (argv.cookie) {
        await page.setCookie(...buildCookies(argv));
    }

    await page.goto(url, buildNavigationOptions(argv));

    const buffer = await page.pdf({
        path: argv.output || null,
        format: argv.format,
        landscape: argv.landscape,
        printBackground: argv.background,
        margin: {
            top: argv.marginTop,
            right: argv.marginRight,
            bottom: argv.marginBottom,
            left: argv.marginLeft
        },
        displayHeaderFooter: argv.displayHeaderFooter,
        headerTemplate: argv.headerTemplate,
        footerTemplate: argv.footerTemplate
    });

    if (!argv.output) {
        await process.stdout.write(buffer);
    }

    await browser.close();
}

async function screenshot(argv) {
    const browser = await puppeteer.launch(buildLaunchOptions(argv));
    const page = await browser.newPage();
    const url = isUrl(argv.url) ? parseUrl(argv.url).toString() : fileUrl(argv.url);

    if (argv.viewport) {
        const formatMatch = argv.viewport.match(/^(?<width>\d+)[xX](?<height>\d+)$/);

        if (!formatMatch) {
            process.exit(1);
        }

        const { width, height } = formatMatch.groups;
        await page.setViewport({
            width: parseInt(width),
            height: parseInt(height)
        });
    }

    if (argv.cookie) {
        await page.setCookie(...buildCookies(argv));
    }

    await page.goto(url, buildNavigationOptions(argv));

    const buffer = await page.screenshot({
        path: argv.output || null,
        fullPage: argv.fullPage,
        omitBackground: argv.omitBackground
    });

    if (!argv.output) {
        await process.stdout.write(buffer);
    }

    await browser.close();
}

function buildLaunchOptions({ sandbox }) {
    const args = [];

    if (sandbox === false) {
        args.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    return {
        args
    };
}

function buildNavigationOptions({ timeout, waitUntil }) {
    return {
        timeout,
        waitUntil
    };
}

function buildCookies({ url, cookie }) {
    return [cookie].map(cookieString => {
        const delimiterOffset = cookieString.indexOf(':');
        if (delimiterOffset == -1) {
            throw new Error('cookie must contain : delimiter');
        }

        const name = cookieString.substr(0, delimiterOffset);
        const value = cookieString.substr(delimiterOffset + 1);

        return { name, value, url };
    });
}
