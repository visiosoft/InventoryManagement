(function(){
  function pascal(n){return n.split('-').map(function(s){return s.charAt(0).toUpperCase()+s.slice(1);}).join('');}
  class PbIcon extends HTMLElement{
    static get observedAttributes(){return ['name','stroke'];}
    constructor(){super();this._r=this.attachShadow({mode:'open'});}
    connectedCallback(){this.render();}
    attributeChangedCallback(){this.render();}
    render(){
      var n=this.getAttribute('name'); if(!n){this._r.innerHTML='';return;}
      var L=window.lucide;
      if(!L||!L.icons){ var self=this; clearTimeout(this._t); this._t=setTimeout(function(){self.render();},60); return; }
      var node=L.icons[pascal(n)];
      if(!node){ this._r.innerHTML=''; return; }
      if(node[0]==='svg') node=node[2];
      var sw=this.getAttribute('stroke')||'2';
      var kids=node.map(function(c){var a=c[1]||{};return '<'+c[0]+' '+Object.keys(a).map(function(k){return k+'="'+a[k]+'"';}).join(' ')+'/>';}).join('');
      this._r.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+sw+'" stroke-linecap="round" stroke-linejoin="round" style="width:100%;height:100%;display:block">'+kids+'</svg>';
    }
  }
  if(!customElements.get('pb-icon')) customElements.define('pb-icon',PbIcon);
})();
