// paint.js - first-paint markup of App from a built payload, for diffing builds.
const fs=require("fs"),React=require("react"),{renderToStaticMarkup}=require("react-dom/server");
const win={addEventListener(){},removeEventListener(){},dispatchEvent(){return true}};
const m=new Map();
const localStorage={get length(){return m.size},key:i=>Array.from(m.keys())[i],
  getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),
  removeItem:k=>m.delete(String(k))};
const navigator={vibrate(){},clipboard:{writeText:()=>Promise.resolve()}};
const document={addEventListener(){},removeEventListener(){},getElementById:()=>null};
const src=fs.readFileSync(process.argv[2],"utf8");
const out=new Function("React","window","localStorage","navigator","document","Event",
  src+"\nreturn { App };")(React,win,localStorage,navigator,document,function(t){return{type:t}});
process.stdout.write(renderToStaticMarkup(React.createElement(out.App)));
