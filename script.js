document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('transaction-form');
    const tableBody = document.querySelector('#portfolio-table tbody');
    const historyTableBody = document.querySelector('#history-table tbody');
    const totalValueSpan = document.getElementById('total-value');
    const totalUnrealizedPnlSpan = document.getElementById('total-unrealized-pnl');
    const totalRealizedPnlSpan = document.getElementById('total-realized-pnl');
    const clearAllBtn = document.getElementById('clear-all');

    let transactions = JSON.parse(localStorage.getItem('cryptoTransactions')) || [];
    let portfolio = {};
    let portfolioValueChart = null;
    let coinPriceChart = null;
    let selectedCoin = null;

    function saveTransactions() {
        localStorage.setItem('cryptoTransactions', JSON.stringify(transactions));
    }

    function updatePortfolio() {
        portfolio = {};
        let fifoQueues = {};

        transactions.forEach(tx => {
            const coin = tx.coin.toLowerCase();
            if (!portfolio[coin]) {
                portfolio[coin] = { quantity: 0, totalCost: 0, realizedPnl: 0, currentPrice: 0, avgPrice: 0 };
                fifoQueues[coin] = [];
            }

            if (tx.action === 'buy') {
                fifoQueues[coin].push({ quantity: tx.quantity, price: tx.price });
                portfolio[coin].quantity += tx.quantity;
                portfolio[coin].totalCost += tx.quantity * tx.price;
            } else if (tx.action === 'sell') {
                let sellQty = tx.quantity;
                let sellPnl = 0;
                while (sellQty > 0 && fifoQueues[coin].length > 0) {
                    const buy = fifoQueues[coin][0];
                    const qtyToSell = Math.min(sellQty, buy.quantity);
                    sellPnl += qtyToSell * (tx.price - buy.price);
                    buy.quantity -= qtyToSell;
                    sellQty -= qtyToSell;
                    if (buy.quantity <= 0) {
                        fifoQueues[coin].shift();
                    }
                }
                portfolio[coin].realizedPnl += sellPnl;
                portfolio[coin].quantity -= tx.quantity;
            }
        });

        Object.keys(portfolio).forEach(coin => {
            if (portfolio[coin].quantity > 0) {
                let remainingCost = 0;
                if (fifoQueues[coin]) {
                    fifoQueues[coin].forEach(item => {
                        remainingCost += item.quantity * item.price;
                    });
                }
                portfolio[coin].totalCost = remainingCost;
                portfolio[coin].avgPrice = remainingCost / portfolio[coin].quantity || 0;
            } else {
                portfolio[coin].avgPrice = 0;
            }
        });
    }

    async function fetchPrices(coins) {
        if (coins.length === 0) return;
        const ids = coins.join(',');
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            Object.keys(data).forEach(coin => {
                if (portfolio[coin]) {
                    portfolio[coin].currentPrice = data[coin].usd || 0;
                }
            });
        } catch (error) {
            console.error('Error fetching prices:', error);
        }
    }

    async function fetchHistoricalPrices(coin, days = 30) {
        const url = `https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=usd&days=${days}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            return data.prices.map(p => ({ time: new Date(p[0]).toLocaleDateString(), value: p[1] }));
        } catch (error) {
            console.error('Error fetching historical prices:', error);
            return [];
        }
    }

    async function fetchPortfolioHistoricalValue(days = 30) {
        const coins = Object.keys(portfolio).filter(c => portfolio[c].quantity > 0);
        if (coins.length === 0) return [];

        const historicalData = {};
        await Promise.all(coins.map(async coin => {
            const prices = await fetchHistoricalPrices(coin, days);
            historicalData[coin] = prices;
        }));

        const dates = [...new Set(Object.values(historicalData).flatMap(d => d.map(p => p.time)))].sort();
        const portfolioValues = dates.map(date => {
            let value = 0;
            coins.forEach(coin => {
                const pricePoint = historicalData[coin].find(p => p.time === date);
                if (pricePoint) value += pricePoint.value * portfolio[coin].quantity;
            });
            return { time: date, value: parseFloat(value.toFixed(2)) };
        });

        return portfolioValues;
    }

    function renderPortfolio() {
        let totalValue = 0;
        let totalUnrealizedPnl = 0;
        let totalRealizedPnl = 0;

        tableBody.innerHTML = '';

        Object.keys(portfolio).forEach(coin => {
            const entry = portfolio[coin];
            if (entry.quantity === 0 && entry.realizedPnl === 0) return;

            const currentValue = entry.quantity * entry.currentPrice;
            const unrealizedPnl = entry.quantity > 0 ? (entry.currentPrice - entry.avgPrice) * entry.quantity : 0;

            totalValue += currentValue;
            totalUnrealizedPnl += unrealizedPnl;
            totalRealizedPnl += entry.realizedPnl;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${coin.charAt(0).toUpperCase() + coin.slice(1)}</td>
                <td>${entry.quantity.toFixed(6)}</td>
                <td>${entry.avgPrice.toFixed(2)} USD</td>
                <td>${entry.currentPrice.toFixed(2)} USD</td>
                <td>${currentValue.toFixed(2)} USD</td>
                <td class="${unrealizedPnl >= 0 ? 'profit' : 'loss'}">${unrealizedPnl.toFixed(2)} USD</td>
                <td class="${entry.realizedPnl >= 0 ? 'profit' : 'loss'}">${entry.realizedPnl.toFixed(2)} USD</td>
                <td><button class="chart-btn" data-coin="${coin}">View Chart</button></td>
            `;
            tableBody.appendChild(row);
        });

        totalValueSpan.textContent = totalValue.toFixed(2);
        totalUnrealizedPnlSpan.textContent = totalUnrealizedPnl.toFixed(2);
        totalRealizedPnlSpan.textContent = totalRealizedPnl.toFixed(2);

        // Attach chart buttons
        document.querySelectorAll('.chart-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                selectedCoin = btn.dataset.coin;
                const data = await fetchHistoricalPrices(selectedCoin, 30);
                renderCoinPriceChart(data, selectedCoin);
            });
        });
    }

    function renderPortfolioValueChart(data) {
        const ctx = document.getElementById('portfolioValueChart').getContext('2d');
        if (portfolioValueChart) portfolioValueChart.destroy();

        portfolioValueChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => d.time),
                datasets: [{
                    label: 'Portfolio Value (USD)',
                    data: data.map(d => d.value),
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.2)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: false }
                }
            }
        });
    }

    function renderCoinPriceChart(data, coinName) {
        const ctx = document.getElementById('coinPriceChart').getContext('2d');
        if (coinPriceChart) coinPriceChart.destroy();

        document.getElementById('selected-coin-chart').style.display = 'block';

        coinPriceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => d.time),
                datasets: [{
                    label: `${coinName.charAt(0).toUpperCase() + coinName.slice(1)} Price (USD)`,
                    data: data.map(d => d.value),
                    borderColor: '#2196F3',
                    backgroundColor: 'rgba(33, 150, 243, 0.2)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: false }
                }
            }
        });
    }

    function renderHistory() {
        historyTableBody.innerHTML = '';

        const sortedTx = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

        sortedTx.forEach((tx, index) => {
            const totalAmount = (tx.quantity * tx.price).toFixed(2);
            const actionClass = tx.action === 'buy' ? 'buy' : 'sell';
            const actionText = tx.action.charAt(0).toUpperCase() + tx.action.slice(1);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${tx.date}</td>
                <td>${tx.coin.charAt(0).toUpperCase() + tx.coin.slice(1)}</td>
                <td class="${actionClass}">${actionText}</td>
                <td>${tx.quantity.toFixed(6)}</td>
                <td>${tx.price.toFixed(2)}</td>
                <td>${totalAmount}</td>
                <td><button class="delete-btn" data-index="${transactions.findIndex(t => t === tx)}">Delete</button></td>
            `;
            historyTableBody.appendChild(row);
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                if (confirm('Are you sure you want to delete this transaction?')) {
                    transactions.splice(idx, 1);
                    saveTransactions();
                    refreshAll();
                }
            });
        });
    }

    async function refreshAll() {
        updatePortfolio();
        const coins = Object.keys(portfolio);
        await fetchPrices(coins);
        renderPortfolio();
        renderHistory();

        // Update charts
        const portfolioHist = await fetchPortfolioHistoricalValue(30);
        renderPortfolioValueChart(portfolioHist);

        if (selectedCoin) {
            const coinData = await fetchHistoricalPrices(selectedCoin, 30);
            renderCoinPriceChart(coinData, selectedCoin);
        }
    }

    form.addEventListener('submit', e => {
        e.preventDefault();
        const coin = document.getElementById('coin').value.trim().toLowerCase();
        const action = document.getElementById('action').value;
        const quantity = parseFloat(document.getElementById('quantity').value);
        const price = parseFloat(document.getElementById('price').value);
        const dateInput = document.getElementById('date').value;
        const date = dateInput || new Date().toISOString().split('T')[0];

        transactions.push({ coin, action, quantity, price, date });
        saveTransactions();
        refreshAll();
        form.reset();
    });

    clearAllBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to delete ALL transactions? This cannot be undone.')) {
            transactions = [];
            localStorage.removeItem('cryptoTransactions');
            refreshAll();
        }
    });

    // Initial load
    refreshAll();
});