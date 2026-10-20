export const PrinterDriver = {
  ESC: 0x1b,
  GS: 0x1d,

  buildEscPosBuffer({ shopName, branchCode, receiptNo, items, subtotal, discount, tax, total, currency }) {
    const encoder = new TextEncoder();
    const parts = [];

    const append = (bytes) => parts.push(new Uint8Array(bytes));
    const appendText = (text) => parts.push(encoder.encode(text));

    // Reset printer
    append([this.ESC, 0x40]);
    // Center alignment
    append([this.ESC, 0x61, 0x01]);
    // Double height & width
    append([this.GS, 0x21, 0x11]);
    appendText(`${shopName}\n`);
    append([this.GS, 0x21, 0x00]);
    appendText(`Branch: ${branchCode}\n`);
    appendText(`Receipt: ${receiptNo}\n`);
    appendText(`${new Date().toLocaleString()}\n`);
    appendText('--------------------------------\n');

    // Left alignment
    append([this.ESC, 0x61, 0x00]);
    items.forEach((item) => {
      const name = (item.name || 'Item').padEnd(18).slice(0, 18);
      const qtyPrice = `${item.quantity}x${(item.price * item.quantity).toFixed(2)}`.padStart(14);
      appendText(`${name}${qtyPrice}\n`);
    });

    appendText('--------------------------------\n');
    append([this.ESC, 0x61, 0x02]);
    appendText(`Subtotal: ${subtotal.toFixed(2)}${currency}\n`);
    if (discount > 0) appendText(`Discount: -${discount.toFixed(2)}${currency}\n`);
    appendText(`Tax: ${tax.toFixed(2)}${currency}\n`);
    append([this.ESC, 0x45, 0x01]); // Bold
    appendText(`TOTAL: ${total.toFixed(2)}${currency}\n`);
    append([this.ESC, 0x45, 0x00]);

    appendText('--------------------------------\n');
    append([this.ESC, 0x61, 0x01]);
    appendText("Goods once sold are not returnable.\nThank you for shopping!\n\n\n");
    append([this.GS, 0x56, 0x42, 0x00]); // Paper Cut

    const totalLength = parts.reduce((acc, p) => acc + p.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  },

  async printViaUSB(payload) {
    if (!navigator.usb) throw new Error('WebUSB is not supported on this browser or requires HTTPS.');
    const device = await navigator.usb.requestDevice({ filters: [] });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);

    const buffer = this.buildEscPosBuffer(payload);
    await device.transferOut(1, buffer);
    await device.close();
  },

  async printViaBluetooth(payload) {
    if (!navigator.bluetooth) throw new Error('WebBluetooth is not supported on this browser or requires HTTPS.');
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
    const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

    const buffer = this.buildEscPosBuffer(payload);
    await characteristic.writeValue(buffer);
    await device.gatt.disconnect();
  },

  printFallbackSlip({ shopName, branchCode, receiptNo, items, subtotal, discount, tax, total, currency }) {
    const win = window.open('', '_blank', 'width=340,height=600');
    if (!win) return;
    const itemsHtml = items.map((i) => `
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span>${i.name} (x${i.quantity})</span>
        <span>${(i.price * i.quantity).toLocaleString()}</span>
      </div>
    `).join('');

    win.document.write(`
      <html>
        <head>
          <title>Receipt ${receiptNo}</title>
          <style>
            body { font-family: monospace; font-size: 12px; margin: 0; padding: 12px; width: 280px; }
            .center { text-align: center; }
            .divider { border-top: 1px dashed #000; margin: 8px 0; }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          <div class="center">
            <strong>${shopName}</strong><br/>
            <span>Branch: ${branchCode}</span><br/>
            <span>Receipt: ${receiptNo}</span><br/>
            <span>${new Date().toLocaleString()}</span>
          </div>
          <div class="divider"></div>
          ${itemsHtml}
          <div class="divider"></div>
          <div style="display:flex; justify-content:space-between;"><span>Subtotal:</span><span>${subtotal.toLocaleString()}</span></div>${discount > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Discount:</span><span>-${discount.toLocaleString()}</span></div>` : ''}
          <div style="display:flex; justify-content:space-between;"><span>Tax:</span><span>${tax.toLocaleString()}</span></div>
          <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:14px; margin-top:4px;">
            <span>TOTAL:</span><span>${total.toLocaleString()}${currency}</span>
          </div>
          <div class="divider"></div>
          <div class="center" style="font-size:10px;">Goods once sold are not returnable.<br/>Thank you!</div>
        </body>
      </html>
    `);
    win.document.close();
  }
};