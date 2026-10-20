// Lightweight pure-JS Code 128 (Subset B) SVG generator
export const BarcodeGenerator = {
  // Code 128 patterns (Subset B)
  patterns: [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112"
  ],

  encode(text) {
    let checkSum = 104; // START_B
    const patternList = [this.patterns[104]];

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i) - 32;
      checkSum += code * (i + 1);
      patternList.push(this.patterns[code] || this.patterns[0]);
    }

    const checkDigit = checkSum % 103;
    patternList.push(this.patterns[checkDigit]);
    patternList.push(this.patterns[106]); // STOP

    // Convert pattern widths to SVG rects
    let x = 10;
    const height = 45;
    let rects = '';

    patternList.forEach((pat) => {
      for (let j = 0; j < pat.length; j++) {
        const width = parseInt(pat[j], 10);
        if (j % 2 === 0) {
          rects += `<rect x="${x}" y="0" width="${width * 1.5}" height="${height}" fill="#000" />`;
        }
        x += width * 1.5;
      }
    });

    return `
      <svg viewBox="0 0 ${x + 10}${height + 18}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%; height:auto;">
        ${rects}
        <text x="${(x + 10) / 2}" y="${height + 14}" font-family="monospace" font-size="11" text-anchor="middle" fill="#000">${text}</text>
      </svg>
    `;
  },

  printLabels(product, quantity = 24, currency = 'KES') {
    const code = product.barcode || product.sku || `QS${product.id.slice(0, 8).toUpperCase()}`;
    const svg = this.encode(code);

    let labelsHtml = '';
    for (let i = 0; i < quantity; i++) {
      labelsHtml += `
        <div class="barcode-label">
          <div class="label-name">${product.name}</div>
          <div class="label-svg">${svg}</div>
          <div class="label-price">${Number(product.retail_price).toLocaleString()}${currency}</div>
        </div>
      `;
    }

    const printWin = window.open('', '_blank', 'width=800,height=900');
    if (!printWin) return;

    printWin.document.write(`
      <html>
        <head>
          <title>Labels - ${product.name}</title>
          <style>
            @page { margin: 10mm; }
            body { font-family: sans-serif; margin: 0; padding: 0; background: #fff; }
            .grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 8px;
            }
            .barcode-label {
              border: 1px dashed #cbd5e1;
              padding: 6px;
              text-align: center;
              border-radius: 4px;
              page-break-inside: avoid;
            }
            .label-name {
              font-size: 10px;
              font-weight: bold;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-bottom: 2px;
            }
            .label-svg svg {
              width: 100%;
              max-height: 48px;
            }
            .label-price {
              font-size: 11px;
              font-weight: 800;
              color: #000;
              margin-top: 2px;
            }
            @media print {
              .barcode-label { border: 1px dotted #94a3b8; }
            }
          </style>
        </head>
        <body onload="window.print();">
          <div class="grid">${labelsHtml}</div>
        </body>
      </html>
    `);
    printWin.document.close();
  }
};