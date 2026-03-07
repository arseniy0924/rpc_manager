const nodeCharts = {}; // Store Chart.js instances: { node_id: Chart }
const MAX_DATA_POINTS = 30;
const gpuColors = ['#4ade80', '#c084fc', '#fbbf24', '#f87171', '#2dd4bf'];

export function updateCardChart(nodeId, data, gpuNames = []) {
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
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { 
                            display: true,
                            position: 'top',
                            labels: {
                                color: '#9ca3af',
                                font: { size: 11 }
                            }
                        } 
                    },
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

    // Update CPU dataset
    chart.data.datasets[0].data.push(cpuLoad);
    chart.data.datasets[0].data.shift();

    // Handle GPU datasets
    const gpus = res.gpus || [];
    
    // Ensure we have enough datasets for all GPUs
    while (chart.data.datasets.length <= gpus.length) {
        const gpuIndex = chart.data.datasets.length - 1; // CPU is at index 0, GPUs start at index 1
        const color = gpuColors[gpuIndex % gpuColors.length];
        
        chart.data.datasets.push({
            label: gpuNames[gpuIndex] || `GPU ${gpuIndex}`,
            data: Array(MAX_DATA_POINTS).fill(0),
            borderColor: color,
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 0
        });
    }

    // Update each GPU dataset
    gpus.forEach((gpu, index) => {
        const datasetIndex = index + 1; // CPU is at index 0, GPUs start at index 1
        const gpuLoad = gpu.load_percent || 0;
        
        chart.data.datasets[datasetIndex].data.push(gpuLoad);
        chart.data.datasets[datasetIndex].data.shift();
    });

    // Remove extra datasets if we have fewer GPUs than before
    while (chart.data.datasets.length > gpus.length + 1) {
        chart.data.datasets.pop();
    }

    chart.update();
}
