const fs = require('fs-extra');
const gapi = require('googleapis');
const readline = require('readline');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function authorize(config) {
    const credentials = JSON.parse(await fs.readFile(config.credentials));

    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const client = new gapi.google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]
    );

    try {
        const token = JSON.parse(await fs.readFile(config.token));
        client.setCredentials(token);
    } catch (e) {
        const token = await getNewToken(config, client);
        client.setCredentials(token);
    }

    return client;
}

function getNewToken(config, auth) {
    const authUrl = auth.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve, reject) => {
        rl.question('Enter the code from that page here: ', (code) => {
            rl.close();
            auth.getToken(code, (err, token) => {
                if (err || !token) {
                    console.error('Error retrieving access token', err);
                    reject(err);
                    return;
                }

                // Store the token to disk for later program executions
                fs.writeFile(config.token, JSON.stringify(token))
                    .then(() => resolve(token));
            });
        });
    });
}

module.exports = {
    authorize
};
