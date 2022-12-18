
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const { StartQueries, TableQueries } = require('./queries');

const app = express();
app.use(cors())
const port = 3000;

const BITCOIN_VERSION = '0.21.1'; // fednode exec bitcoin bitcoin-cli -version
const COUNTERPARTY_VERSION = '9.59.6'; // fednode exec counterparty counterparty-client --version (we want continuous improvements, but avoid forks as much as possible)

// read only
const DB_PATH = '/var/lib/docker/volumes/federatednode_counterparty-data/_data/counterparty.db'

// https://github.com/TryGhost/node-sqlite3/wiki/API
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);



app.get('/mempool', async (req, res) => {
    const mempool = await StartQueries.getMempoolRows(db);
    res.status(200).json({
        node: {
            BITCOIN_VERSION,
            COUNTERPARTY_VERSION,
        },
        mempool,
    });
});

app.get('/blocks1', async (req, res) => {
    const blocks = await StartQueries.getMessagesByBlockLatest(db);
    res.status(200).json({
        node: {
            BITCOIN_VERSION,
            COUNTERPARTY_VERSION,
        },
        blocks,
    });
});

app.get('/blocks', async (req, res) => {
    const blocks = await StartQueries.getMessagesByBlockLatest(db);
    res.status(200).json({
        node: {
            BITCOIN_VERSION,
            COUNTERPARTY_VERSION,
        },
        blocks,
    });
});

app.get('/tx/:txHash', async (req, res) => {
    const tx_hash = req.params.txHash;
    // transaction could be in the mempool
    // but first try get direct from table

    let mempool = [];
    let messages = [];

    let messages_all = []; // also returning all block messages to continue discovering
    let transaction = await StartQueries.getTransactionsRow(db, tx_hash);
    if (transaction) {
        // get the block...
        const block_index = transaction.block_index;
        // then get all messages from block...
        messages_all = await StartQueries.getMessagesRowsByBlock(db, block_index);
        for (const message of messages_all) {

            const bindings = JSON.parse(message.bindings);
            // TODO dispensers:update instead of 'dispenser_tx_hash' like dispenses:insert is just 'tx_hash' thus missing it here with this check
            // TODO orders:update similar, it has 'offer_hash' in cancels:insert but 'tx_hash' here thus also being missed here
            if (
                (bindings.tx_hash && bindings.tx_hash === tx_hash) ||
                (bindings.event && bindings.event === tx_hash)
            ) {

                if (
                    (
                        message.category === 'issuances' &&
                        message.command === 'insert'
                    ) ||
                    (
                        message.category === 'destructions' &&
                        message.command === 'insert'
                    ) ||
                    (
                        message.category === 'sends' &&
                        message.command === 'insert'
                    ) ||
                    (
                        message.category === 'dispensers' &&
                        message.command === 'insert'
                    ) ||
                    (
                        message.category === 'dispenses' &&
                        message.command === 'insert'
                    ) ||
                    (
                        message.category === 'orders' &&
                        message.command === 'insert'
                    ) ||
                    ( // TODO why cancels is an insert, and closing a dispenser is just a credits+update (no "cancel" like insert?)
                        message.category === 'cancels' &&
                        message.command === 'insert'
                    ) ||
                    ( // TODO this one is done differently and i'm not sure is the best design (or the others are not?) (inconsistency...)
                        message.category === 'credits' &&
                        message.command === 'insert' &&
                        bindings.action === 'close dispenser'
                    )
                ) {
                    message.main_message = true;
                    messages.push(message);
                }
                else {
                    messages.push(message);
                }

            }

        }

    }
    else { // try if is in mempool
        mempool = await StartQueries.getMempoolRowsByTxhash(db, tx_hash);
    }

    if (!transaction && !mempool.length) {
        res.status(404).json({
            error: '404 Not Found'
        });
    }
    else {
        res.status(200).json({
            transaction,

            messages_all,
            messages,
            mempool,
        });
    }
});

app.get('/block/:blockIndex', async (req, res) => {
    const block_index = req.params.blockIndex;
    const block_row = await StartQueries.getBlocksRow(db, block_index);
    if (!block_row) {
        res.status(404).json({
            error: '404 Not Found'
        });
    }
    else {
        const messages = await StartQueries.getMessagesRowsByBlock(db, block_index);
        res.status(200).json({
            block_row,
            messages,
        });
    }
});

app.get('/address/:address', async (req, res) => {
    const address = req.params.address;
    const tables = {};
    tables.balances = await TableQueries.getBalancesRowsByAddress(db, address);
    tables.broadcasts = await TableQueries.getBroadcastsRowsByAddress(db, address);
    res.status(200).json({
        tables,
    });
});

app.get('/asset/:assetName', async (req, res) => {
    const asset_name = req.params.assetName;
    const asset_row = await TableQueries.getAssetsRowByAssetName(db, asset_name);
    if (!asset_row) {
        res.status(404).json({
            error: '404 Not Found'
        });
    }
    else {
        let issuances = [];
        let destructions = [];
        // TODO more! there are XCP destroys... and do something with the burns?
        if (!['BTC', 'XCP'].includes(asset_name)) {
            issuances = await TableQueries.getIssuancesRowsByAssetName(db, asset_name);
            destructions = await TableQueries.getDestructionsRowsByAssetName(db, asset_name);
        }
        res.status(200).json({
            asset_row,
            // mixed is ok!
            tables: {
                issuances,
                destructions
            },
        });
    }
});



app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
