const fs = require('fs');

// Create a proper SVG icon for HC3 MCP Server
const svgIcon = `<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <!-- Background circle -->
  <circle cx="64" cy="64" r="60" fill="#2563eb" stroke="#1d4ed8" stroke-width="2"/>
  
  <!-- Home/House icon representing Smart Home -->
  <path d="M32 76 L64 44 L96 76 L96 100 L72 100 L72 84 L56 84 L56 100 L32 100 Z" 
        fill="white" stroke="white" stroke-width="1"/>
  
  <!-- Roof detail -->
  <path d="M28 76 L64 40 L100 76" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>
  
  <!-- Window -->
  <rect x="60" y="88" width="8" height="8" fill="#2563eb"/>
  
  <!-- Connection dots representing MCP/API -->
  <circle cx="40" cy="32" r="3" fill="#10b981"/>
  <circle cx="88" cy="32" r="3" fill="#10b981"/>
  <circle cx="104" cy="64" r="3" fill="#10b981"/>
  <circle cx="88" cy="96" r="3" fill="#10b981"/>
  <circle cx="40" cy="96" r="3" fill="#10b981"/>
  <circle cx="24" cy="64" r="3" fill="#10b981"/>
  
  <!-- Connection lines -->
  <path d="M40 32 L60 48" stroke="#10b981" stroke-width="2" opacity="0.7"/>
  <path d="M88 32 L68 48" stroke="#10b981" stroke-width="2" opacity="0.7"/>
  <path d="M104 64 L80 64" stroke="#10b981" stroke-width="2" opacity="0.7"/>
  <path d="M24 64 L48 64" stroke="#10b981" stroke-width="2" opacity="0.7"/>
  
  <!-- HC3 text at bottom -->
  <text x="64" y="118" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="12" font-weight="bold">HC3</text>
</svg>`;

// Write the SVG
fs.writeFileSync('icon-proper.svg', svgIcon);
console.log('Created proper SVG icon: icon-proper.svg');

// Create a proper PNG using Canvas (if available) or provide instructions
try {
  // Try to use node-canvas if available
  const { createCanvas } = require('canvas');
  
  const canvas = createCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  
  // Blue background circle
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, 2 * Math.PI);
  ctx.fill();
  
  // White border
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // House shape
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.moveTo(32, 76);
  ctx.lineTo(64, 44);
  ctx.lineTo(96, 76);
  ctx.lineTo(96, 100);
  ctx.lineTo(72, 100);
  ctx.lineTo(72, 84);
  ctx.lineTo(56, 84);
  ctx.lineTo(56, 100);
  ctx.lineTo(32, 100);
  ctx.closePath();
  ctx.fill();
  
  // Roof line
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(28, 76);
  ctx.lineTo(64, 40);
  ctx.lineTo(100, 76);
  ctx.stroke();
  
  // Window
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(60, 88, 8, 8);
  
  // Connection dots
  const dots = [
    [40, 32], [88, 32], [104, 64], [88, 96], [40, 96], [24, 64]
  ];
  ctx.fillStyle = '#10b981';
  dots.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * Math.PI);
    ctx.fill();
  });
  
  // Connection lines
  ctx.strokeStyle = '#10b981';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;
  const lines = [
    [40, 32, 60, 48],
    [88, 32, 68, 48],
    [104, 64, 80, 64],
    [24, 64, 48, 64]
  ];
  lines.forEach(([x1, y1, x2, y2]) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
  
  // HC3 text
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'white';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('HC3', 64, 118);
  
  // Save as PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync('icon.png', buffer);
  console.log('Created proper PNG icon: icon.png (128x128)');
  
} catch (error) {
  console.log('Canvas not available. Created SVG only.');
  console.log('To convert SVG to PNG, you can:');
  console.log('1. Use online converter: https://cloudconvert.com/svg-to-png');
  console.log('2. Install canvas: npm install canvas');
  console.log('3. Use ImageMagick: convert icon-proper.svg icon.png');
}
