require('dotenv').config();
const express = require('express');
const axios = require('axios');
const homerooms = require('./homerooms');  // Import the homerooms object

const app = express();
const PORT = 3000;

const destinyApiUrl = "https://lmc.isb.cn/api/v1/rest/context/destiny";
let accessToken = process.env.ACCESS_TOKEN;
let tokenExpiration = null;

async function fetchAccessToken() {
    try {
        console.log("Fetching new access token...");
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', process.env.CLIENT_ID);
        params.append('client_secret', process.env.CLIENT_SECRET);

        const response = await axios.post(`${destinyApiUrl}/auth/accessToken`, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        accessToken = response.data.access_token;
        tokenExpiration = Date.now() + (response.data.expires_in * 1000);
        console.log("New access token retrieved successfully:", accessToken);
    } catch (error) {
        console.error("Error fetching access token:", error.message);
        throw new Error("Failed to fetch access token");
    }
}

async function ensureAccessToken(req, res, next) {
    if (!accessToken || Date.now() >= tokenExpiration) {
        await fetchAccessToken();
    }
    next();
}

// Endpoint to retrieve predefined homerooms
app.get('/api/homerooms', (req, res) => {
    res.json(Object.keys(homerooms)); // Send homeroom names to the client
});

// Endpoint to retrieve students and their checkout counts for a selected homeroom
app.get('/api/homerooms/:homeroom/students', ensureAccessToken, async (req, res) => {
    const homeroom = req.params.homeroom;
    const districtIds = homerooms[homeroom];

    if (!districtIds) {
        return res.status(404).json({ error: "Homeroom not found" });
    }

    try {
        const students = await Promise.all(districtIds.map(async (districtId) => {
            const response = await axios.get(`${destinyApiUrl}/circulation/patrons/${districtId}/status`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            const patron = response.data;
            const booksCheckedOut = patron.itemsOut ? patron.itemsOut.length : 0;

            // Calculate overdue items
            const today = new Date();
            const overdueBooks = patron.itemsOut ? patron.itemsOut.filter(item => new Date(item.dateDue) < today).length : 0;

            // Determine starting books allowed based on the homeroom name
            const startingBooksAllowed = /^[345]/.test(homeroom) ? 5 : 3;

            // Calculate final books allowed
            let booksAllowed = startingBooksAllowed - booksCheckedOut;
            if (booksAllowed < 1) booksAllowed = 1;
            if (overdueBooks > 0) booksAllowed = 1;  // Set to 1 if any overdue books

            return {
                name: `${patron.firstName} ${patron.lastName}`,
                booksCheckedOut,
                overdueBooks,
                booksAllowed,
            };
        }));

        res.json(students);
    } catch (error) {
        console.error("Error fetching student data:", error.message);
        res.status(error.response ? error.response.status : 500).json({
            error: error.message,
            details: error.response ? error.response.data : "No additional details",
        });
    }
});

app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
