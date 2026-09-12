import {Component,type ReactNode} from 'react';

/** A deployment can replace a lazy asset while an older tab is still open.
 * React caches a rejected lazy import; rerendering alone cannot retry it. */
export class LoadBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<section className="workspace-card load-recovery" role="alert">
    <h2>This panel could not open</h2><p>Check your connection and reload the app to get the current version.</p>
    <button className="btn" onClick={()=>location.reload()}>Reload app</button>
  </section>:this.props.children;}
}
