(function () {
  window.FannaloWallet = class FannaloWallet {
    constructor(db, p2p) {
      this.db = db;
      this.p2p = p2p;
    }

    async getBalance(userId) {
      const user = await this.db.getUser(userId);
      return user ? user.credits || 0 : 0;
    }

    async getTransactions(userId) {
      const txs = await this.db.getTransactions(userId);
      return txs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    async topUpPayPal(userId, amount) {
      return new Promise((resolve, reject) => {
        if (!window.paypal) {
          reject(new Error('PayPal SDK not loaded'));
          return;
        }

        const tempContainer = document.createElement('div');
        tempContainer.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:#1a1a2e;padding:24px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.5);width:400px;max-width:90vw;';

        tempContainer.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="color:#fff;font-size:18px;font-weight:600;">Complete Payment</h3>
            <button id="paypal-close" style="background:none;border:none;color:#888;font-size:24px;cursor:pointer;">&times;</button>
          </div>
          <div style="color:#aaa;font-size:14px;margin-bottom:16px;">Adding <strong style="color:#fff;">${amount} credits</strong> ($${amount.toFixed(2)})</div>
          <div id="paypal-button-container"></div>
        `;

        document.body.appendChild(tempContainer);
        document.getElementById('paypal-close').onclick = () => {
          tempContainer.remove();
          reject(new Error('Payment cancelled'));
        };

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9998;';
        overlay.id = 'paypal-overlay';
        document.body.appendChild(overlay);

        const cleanup = () => {
          tempContainer.remove();
          overlay.remove();
        };

        try {
          window.paypal.Buttons({
            createOrder: (data, actions) => {
              return actions.order.create({
                purchase_units: [{
                  amount: { value: amount.toFixed(2) },
                  description: `${amount} Fannalo Credits`
                }]
              });
            },
            onApprove: async (data, actions) => {
              const details = await actions.order.capture();
              if (details.status === 'COMPLETED') {
                await this.db.addCredits(userId, amount, 'paypal');
                cleanup();
                resolve({
                  success: true,
                  transactionId: details.id,
                  amount,
                  payerEmail: details.payer.email_address
                });
              } else {
                cleanup();
                reject(new Error('Payment not completed'));
              }
            },
            onCancel: () => {
              cleanup();
              reject(new Error('Payment cancelled'));
            },
            onError: (err) => {
              cleanup();
              reject(new Error('Payment error: ' + err.message));
            }
          }).render('#paypal-button-container');
        } catch (e) {
          cleanup();
          reject(e);
        }
      });
    }

    async sendCredits(fromUserId, toUserId, amount) {
      const success = await this.db.spendCredits(fromUserId, amount, `Transfer to user ${toUserId}`);
      if (!success) throw new Error('Insufficient credits');
      await this.db.addCredits(toUserId, amount, 'transfer');
      if (this.p2p) {
        this.p2p.sendNotification(toUserId, {
          kind: 'credit_received',
          message: `Received ${amount} credits`
        });
      }
      return true;
    }

    async sendTip(fromUserId, toUserId, postId, amount) {
      return await this.db.addTip(fromUserId, toUserId, postId, amount);
    }

    async purchaseSubscription(userId, creatorId, price) {
      const success = await this.db.spendCredits(userId, price, `Subscription to ${creatorId}`);
      if (!success) throw new Error('Insufficient credits');
      await this.db.subscribe(userId, creatorId);
      const creator = await this.db.getUser(creatorId);
      if (creator) {
        creator.earnings = (creator.earnings || 0) + price;
        await this.db.put(creator);
      }
      return true;
    }

    formatCredits(amount) {
      return new Intl.NumberFormat('en-US', {
        style: 'decimal',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount || 0);
    }
  };
})();
