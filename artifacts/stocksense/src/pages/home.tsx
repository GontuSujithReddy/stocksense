import { Link } from 'wouter';
import { ArrowRight, ArrowUpRight, Box, ArrowLeftRight, MapPin, ScanLine, PackageCheck, CornerDownRight, Check, Layers3 } from 'lucide-react';
import { Brand } from '../components/common';

const capabilities = [
  { number: '01', icon: Box, title: 'Know what you have.', description: 'Keep products, SKUs, and stock health together in one clear view.', tag: 'PRODUCTS' },
  { number: '02', icon: MapPin, title: 'Know where it lives.', description: 'Look beyond a total. See stock by warehouse and storage location.', tag: 'LOCATIONS' },
  { number: '03', icon: ArrowLeftRight, title: 'Know what changed.', description: 'Follow receipts, deliveries, transfers, and adjustments as they happen.', tag: 'MOVEMENTS' },
];

export default function Home() {
  return (
    <div className="ss-home">
      <header className="ss-home-header">
        <div className="ss-home-brand"><Brand /></div>
        <nav className="ss-home-nav" aria-label="Main navigation">
          <a href="#how-it-works" className="ss-home-nav-about" data-testid="link-how-it-works">How it works</a>
          <Link href="/sign-in" data-testid="link-sign-in">Sign in</Link>
          <Link href="/sign-up" className="ss-home-header-cta" data-testid="link-sign-up">Get started <ArrowUpRight size={15} strokeWidth={2} /></Link>
        </nav>
      </header>

      <main>
        <section className="ss-home-hero" aria-labelledby="ss-home-title">
          <div className="ss-home-hero-inner">
            <div className="ss-home-hero-copy">
              <div className="ss-home-kicker"><span className="ss-home-kicker-dot" /> Inventory &amp; dispatch for every seller</div>
              <h1 id="ss-home-title">Know what you have.<br />Know <em>where it is.</em></h1>
              <p className="ss-home-hero-description">Your own workspace for products, warehouses, and dispatches. See what is in stock, where it is, and what moves next.</p>
              <div className="ss-home-hero-actions">
                <Link href="/sign-up" className="ss-home-button ss-home-button-dark" data-testid="link-start-free">Start your workspace <ArrowUpRight size={18} /></Link>
                <a href="#how-it-works" className="ss-home-text-link" data-testid="link-explore-features">See how it works <ArrowRight size={17} /></a>
              </div>
              <div className="ss-home-hero-footnote"><span className="ss-home-footnote-line" /> Less searching. More moving.</div>
            </div>

            <div className="ss-home-visual-wrap" aria-label="Illustration showing how a product connects to its location and movement history">
              <div className="ss-home-visual-orbit ss-home-visual-orbit-one" />
              <div className="ss-home-visual-orbit ss-home-visual-orbit-two" />
              <div className="ss-home-visual">
                <div className="ss-home-visual-head"><div className="ss-home-visual-mark"><Layers3 size={17}/></div><span>THE FULL PICTURE</span><span className="ss-home-visual-head-right">STOCKSENSE / 01</span></div>
                <div className="ss-home-visual-body">
                  <div className="ss-home-map-label"><span>FROM ITEM TO ANSWER</span><ScanLine size={18}/></div>
                  <div className="ss-home-flow">
                    <div className="ss-home-flow-row">
                      <div className="ss-home-flow-icon ss-home-flow-icon-coral"><Box size={22} strokeWidth={1.8}/></div>
                      <div><span className="ss-home-flow-overline">START WITH</span><strong>A product</strong><small>Everything you stock, easy to find.</small></div>
                      <span className="ss-home-flow-index">01</span>
                    </div>
                    <div className="ss-home-flow-connector"><span /></div>
                    <div className="ss-home-flow-row">
                      <div className="ss-home-flow-icon ss-home-flow-icon-green"><MapPin size={22} strokeWidth={1.8}/></div>
                      <div><span className="ss-home-flow-overline">SEE ITS PLACE</span><strong>A location</strong><small>The warehouse and spot it belongs.</small></div>
                      <span className="ss-home-flow-index">02</span>
                    </div>
                    <div className="ss-home-flow-connector"><span /></div>
                    <div className="ss-home-flow-row">
                      <div className="ss-home-flow-icon ss-home-flow-icon-cream"><ArrowLeftRight size={22} strokeWidth={1.8}/></div>
                      <div><span className="ss-home-flow-overline">FOLLOW THE TRAIL</span><strong>A movement</strong><small>What came in, went out, or moved.</small></div>
                      <span className="ss-home-flow-index">03</span>
                    </div>
                  </div>
                </div>
                <div className="ss-home-visual-bottom"><Check size={15}/><span>Connected, from shelf to shift.</span><ArrowUpRight size={16}/></div>
              </div>
              <span className="ss-home-visual-caption">A SIMPLE WAY TO SEE HOW IT ALL CONNECTS <span>↗</span></span>
            </div>
          </div>
        </section>

        <div className="ss-home-band" aria-label="StockSense connects products, locations, and movements">
          <span>YOUR WORKSPACE</span><i /><span>PRODUCTS</span><ArrowRight size={15}/><span>LOCATIONS</span><ArrowRight size={15}/><span>MOVEMENTS</span><i /><span>ONE CLEAR ANSWER</span>
        </div>

        <section className="ss-home-story" id="how-it-works" aria-labelledby="ss-home-story-title">
          <div className="ss-home-story-top">
            <div className="ss-home-section-label"><span className="ss-home-section-square"/> WHAT STOCKSENSE DOES</div>
            <h2 id="ss-home-story-title">Every item. Every move.<br /><span>Your business in focus.</span></h2>
            <p>Receive stock, find its location, and dispatch orders—all in your own workspace.</p>
          </div>
          <div className="ss-home-capabilities">
            {capabilities.map(({number, icon: Icon, title, description, tag}) => (
              <div className="ss-home-capability" key={number}>
                <span className="ss-home-capability-number">{number} / 03</span>
                <div className="ss-home-capability-icon"><Icon size={23} strokeWidth={1.7}/></div>
                <div className="ss-home-capability-content"><h3>{title}</h3><p>{description}</p></div>
                <span className="ss-home-capability-tag">{tag} <ArrowUpRight size={15}/></span>
              </div>
            ))}
          </div>
        </section>

        <section className="ss-home-questions" aria-labelledby="ss-home-questions-title">
          <div className="ss-home-questions-inner">
            <div className="ss-home-questions-copy">
              <div className="ss-home-section-label"><span className="ss-home-section-square"/> MADE FOR THE MOMENT YOU NEED IT</div>
              <h2 id="ss-home-questions-title">Good questions.<br /><em>Clear answers.</em></h2>
              <p>From the first receipt to the next transfer, keep the details close and the next step obvious.</p>
              <Link href="/sign-up" className="ss-home-text-link ss-home-questions-link" data-testid="link-questions-start">Get started with StockSense <ArrowUpRight size={17}/></Link>
            </div>
            <div className="ss-home-question-list">
              <div className="ss-home-question"><span className="ss-home-question-icon"><Box size={19}/></span><div><small>FIND IT</small><strong>What do we have?</strong></div><CornerDownRight size={18}/></div>
              <div className="ss-home-question"><span className="ss-home-question-icon"><MapPin size={19}/></span><div><small>PLACE IT</small><strong>Where is it stored?</strong></div><CornerDownRight size={18}/></div>
              <div className="ss-home-question"><span className="ss-home-question-icon"><PackageCheck size={19}/></span><div><small>TRACE IT</small><strong>What happened to it?</strong></div><CornerDownRight size={18}/></div>
              <div className="ss-home-question-end"><span className="ss-home-question-end-dot"/> The answer is in your workspace.</div>
            </div>
          </div>
        </section>

        <section className="ss-home-close" aria-labelledby="ss-home-close-title">
          <div className="ss-home-close-inner">
            <div className="ss-home-section-label"><span className="ss-home-section-square"/> READY WHEN YOU ARE</div>
            <h2 id="ss-home-close-title">Make room for<br /><em>clarity.</em></h2>
            <div className="ss-home-close-bottom"><p>A more grounded way to run what’s in stock, where it goes, and what comes next.</p><Link href="/sign-up" className="ss-home-button ss-home-button-dark" data-testid="link-footer-start">Create your workspace <ArrowUpRight size={18}/></Link></div>
            <div className="ss-home-close-decoration" aria-hidden="true"><span/><span/><span/><span/></div>
          </div>
        </section>
      </main>

      <footer className="ss-home-footer"><Brand light/><span>Inventory, with the uncertainty taken out.</span><a href="#ss-home-title" data-testid="link-back-to-top">Back to top ↑</a></footer>
    </div>
  );
}