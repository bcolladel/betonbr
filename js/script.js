
(function(){
  const nav=document.getElementById('nav');
  window.addEventListener('scroll',()=>{nav.classList.toggle('scrolled',scrollY>30)},{passive:true});

  const items=document.querySelectorAll('.reveal');
  const io=new IntersectionObserver((entries)=>{
    entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');io.unobserve(e.target)}})
  },{threshold:.1,rootMargin:'0px 0px -50px 0px'});
  items.forEach((el,i)=>{el.style.transitionDelay=(i%4)*55+'ms';io.observe(el)});

  document.getElementById('yr').textContent=new Date().getFullYear();

  const form=document.getElementById('leadForm');
  const ok=document.getElementById('formOk');
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const n=form.querySelector('[name="nome"]').value.trim();
    const em=form.querySelector('[name="email"]').value.trim();
    if(!n||!em){
      form.querySelectorAll('[required]').forEach(f=>{if(!f.value.trim())f.style.borderColor='#ff5a87'});
      return;
    }
    ok.style.display='block';form.reset();
    setTimeout(()=>ok.style.display='none',6000);
  });
  form.querySelectorAll('input,select').forEach(f=>f.addEventListener('input',()=>f.style.borderColor=''));
})();
