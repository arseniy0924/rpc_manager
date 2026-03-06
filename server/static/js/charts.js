const nodeCharts = {}; // Store Chart.js instances: { node_id: Chart }
const MAX_DATA_POINTS = 30;

export function updateCardChart(nodeId, data) {
    let chart = nodeCharts[nodeId];

    // If chart doesn't exist, create it (assuming canvas exists in DOM)
    if (!chart) {
        const canvas = document.querySelector(`#node-${nodeId} .node-chart`);
        if (canvas) {
            const ctx = canvas.getContext('2d');
            chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: Array(MAX_DATA_POINTS).fill(''),
                    datasets: [
                        {
                            label: 'CPU %',
                            data: Array(MAX_DATA_POINTS).fill(0),
                            borderColor: '#60a5fa', // Blue-400
                            borderWidth: 2,
                            tension: 0.4,
                            pointRadius: 0
                        },
                        {
                            label: 'GPU %',
                            data: Array(MAX_DATA_POINTS).fill(0),
                            borderColor: '#4ade80', // Green-400
                            borderWidth: 2,
                            tension: 0.4,
                            pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { display: false },
                        y: {
                            beginAtZero: true,
                            max: 100,
                            grid: { color: '#374151' }, // Gray-700
                            ticks: { color: '#9ca3af', font: { size: 10 } }
                        }
                    },
                    animation: false // Disable animation for smooth real-time updates
                }
            });
            nodeCharts[nodeId] = chart;
        } else {
            return; // Canvas not ready yet
        }
    }

    const res = data.resources || {};
    const cpuLoad = res.cpu_percent || 0;

    // Calculate GPU Load (average if multiple, or first)
    let gpuLoad = 0;
    if (res.gpus && res.gpus.length > 0) {
        gpuLoad = res.gpus[0].load_percent || 0;
    }

    // Shift data
    chart.data.datasets[0].data.push(cpuLoad);
    chart.data.datasets[0].data.shift();

    chart.data.datasets[1].data.push(gpuLoad);
    chart.data.datasets[1].data.shift();

    chart.update();
}
