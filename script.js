document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('transaction-form');
    const portfolioCards = document.getElementById('portfolio-cards');
    const historyCards = document.getElementById('history-cards');
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
                    if (buy.quantity <= 0) fifoQueues[coin].shift();
                }
                portfolio[coin].realizedPnl += sellPnl;
                portfolio[coin].quantity -= tx.quantity;
            }
        });

        Object.keys(portfolio).forEach(coin => {
            if (portfolio[coin].quantity > 0) {
                let remainingCost = 0;
                if (fifoQueues[coin]) {
                    fifoQueues[coin].forEach(item => remainingCost += item.quantity * item.price);
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
            const res = await fetch(url);
            const data = await res.json();
            Object.keys(data).forEach(coin => {
                if (portfolio[coin]) portfolio[coin].currentPrice = data[coin].usd || 0;
            });
        } catch (e) { console.error(e); }
    }

    async function fetchHistoricalPrices(coin, days = 30) {
        const url = `https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=usd&days=${days}`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            return data.prices.map(p => ({ time: new Date(p[0]).toLocaleDateString(), value: p[1] }));
        } catch (e) {
            console.error(e);
            return [];
        }
    }

    async function fetchPortfolioHistoricalValue(days = 30) {
        const coins = Object.keys(portfolio).filter(c => portfolio[c].quantity > 0);
        if (coins.length === 0) return [];

        const historicalData = {};
        await Promise.all(coins.map(async coin => {
            historicalData[coin] = await fetchHistoricalPrices(coin, days);
        }));

        const dates = [...new Set(Object.values(historicalData).flatMap(d => d.map(p => p.time)))].sort();
        return dates.map(date => {
            let value = 0;
            coins.forEach(coin => {
                const point = historicalData[coin].find(p => p.time === date);
                if (point) value += point.value * portfolio[coin].quantity;
            });
            return { time: date, value: parseFloat(value.toFixed(2)) };
        });
    }

    function renderPortfolioCards() {
        portfolioCards.innerHTML = '';
        let totalValue = 0;
        let totalUnrealized = 0;
        let totalRealized = 0;

        Object.keys(portfolio).forEach(coin => {
            const e = portfolio[coin];
            if (e.quantity === 0 && e.realizedPnl === 0) return;

            const currentValue = e.quantity * e.currentPrice;
            const unrealized = e.quantity > 0 ? (e.currentPrice - e.avgPrice) * e.quantity : 0;

            totalValue += currentValue;
            totalUnrealized += unrealized;
            totalRealized += e.realizedPnl;

            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-header">
                    <span>${coin.charAt(0).toUpperCase() + coin.slice(1)}</span>
                    <button class="chart-btn" data-coin="${coin}">Chart</button>
                </div>
                <div class="card-grid">
                    <div class="card-item"><span class="card-label">Holding</span><span class="card-value">${e.quantity.toFixed(6)}</span></div>
                    <div class="card-item"><span class="card-label">Avg Buy</span><span class="card-value">$${e.avgPrice.toFixed(2)}</span></div>
                    <div class="card-item"><span class="card-label">Current Price</span><span class="card-value">$${e.currentPrice.toFixed(2)}</span></div>
                    <div class="card-item"><span class="card-label">Value</span><span class="card-value">$${currentValue.toFixed(2)}</span></div>
                    <div class="card-item"><span class="card-label">Unrealized PnL</span><span class="card-value ${unrealized >= 0 ? 'profit' : 'loss'}">$${unrealized.toFixed(2)}</span></div>
                    <div class="card-item"><span class="card-label">Realized PnL</span><span class="card-value ${e.realizedPnl >= 0 ? 'profit' : 'loss'}">$${e.realizedPnl.toFixed(2)}</span></div>
                </div>
            `;
            portfolioCards.appendChild(card);
        });

        totalValueSpan.textContent = totalValue.toFixed(2);
        totalUnrealizedPnlSpan.textContent = totalUnrealized.toFixed(2);
        totalRealizedPnlSpan.textContent = totalRealized.toFixed(2);

        document.querySelectorAll('.chart-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                selectedCoin = btn.dataset.coin;
                const data = await fetchHistoricalPrices(selectedCoin, 30);
                renderCoinPriceChart(data, selectedCoin);
            });
        });
    }

    function renderHistoryCards() {
        historyCards.innerHTML = '';
        const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

        sorted.forEach((tx, i) => {
            const total = (tx.quantity * tx.price).toFixed(2);
            const actionClass = tx.action === 'buy' ? 'buy' : 'sell';
            const actionText = tx.action.charAt(0).toUpperCase() + tx.action.slice(1);

            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-grid">
                    <div class="card-item"><span class="card-label">Date</span><span class="card-value">${tx.date}</span></div>
                    <div class="card-item"><span class="card-label">Coin</span><span class="card-value">${tx.coin.charAt(0).toUpperCase() + tx.coin.slice(1)}</span></div>
                    <div class="card-item"><span class="card-label">Action</span><span class="card-value ${actionClass}">${actionText}</span></div>
                    <div class="card-item"><span class="card-label">Quantity</span><span class="card-value">${tx.quantity.toFixed(6)}</span></div>
                    <div class="card-item"><span class="card-label">Price</span><span class="card-value">$${tx.price.toFixed(2)}</span></div>
                    <div class="card-item"><span class="card-label">Total</span><span class="card-value">$${total}</span></div>
                    <div class="card-item" style="grid-column: span 2;"><button class="delete-btn" data-index="${transactions.findIndex(t => t === tx)}">Delete</button></div>
                </div>
            `;
            historyCards.appendChild(card);
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const idx = parseInt(e.target.dataset.index);
                if (confirm('Delete this transaction?')) {
                    transactions.splice(idx, 1);
                    saveTransactions();
                    refreshAll();
                }
            });
        });
    }

    function renderPortfolioValueChart(data) {
        const ctx = document.getElementById('portfolioValueChart').getContext('2d');
        if (portfolioValueChart) portfolioValueChart.destroy();
        portfolioValueChart = new Chart(ctx, {
            type: 'line',
            data: { labels: data.map(d => d.time), datasets: [{ label: 'Portfolio Value (USD)', data: data.map(d => d.value), borderColor: '#4CAF50', backgroundColor: 'rgba(76,175,80,0.2)', fill: true, tension: 0.3 }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    function renderCoinPriceChart(data, coinName) {
        const ctx = document.getElementById('coinPriceChart').getContext('2d');
        if (coinPriceChart) coinPriceChart.destroy();
        document.getElementById('selected-coin-chart').style.display = 'block';
        document.getElementById('coin-chart-title').textContent = `${coinName.charAt(0).toUpperCase() + coinName.slice(1)} Price (30 Days)`;
        coinPriceChart = new Chart(ctx, {
            type: 'line',
            data: { labels: data.map(d => d.time), datasets: [{ label: `${coinName.charAt(0).toUpperCase() + coinName.slice(1)} Price (USD)`, data: data.map(d => d.value), borderColor: '#2196F3', backgroundColor: 'rgba(33,150,243,0.2)', fill: true, tension: 0.3 }] },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    async function refreshAll() {
        updatePortfolio();
        await fetchPrices(Object.keys(portfolio));
        renderPortfolioCards();
        renderHistoryCards();
        const hist = await fetchPortfolioHistoricalValue(30);
        renderPortfolioValueChart(hist);
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
        const date = document.getElementById('date').value || new Date().toISOString().split('T')[0];

        transactions.push({ coin, action, quantity, price, date });
        saveTransactions();
        refreshAll();
        form.reset();
    });

    clearAllBtn.addEventListener('click', () => {
        if (confirm('Delete ALL transactions?')) {
            transactions = [];
            localStorage.removeItem('cryptoTransactions');
            refreshAll();
        }
    });

    refreshAll();
});