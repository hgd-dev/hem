const express=require('express')
const compression=require('compression')
const cors=require('cors')
const netApi=require('net-browserify')

const PORT=Number(process.env.PORT||8080)
const HOST=process.env.MC_HOST||'orchestrator'
const START=Number(process.env.WORLD_PORT_START||31000)
const END=Number(process.env.WORLD_PORT_END||31099)
const ORIGIN=process.env.CLIENT_ORIGIN||'*'
if(!Number.isInteger(START)||!Number.isInteger(END)||START<1024||END<START||END-START>500)throw new Error('Invalid HEM port range')
const destinations=Array.from({length:END-START+1},(_,i)=>({host:HOST,port:START+i}))
const app=express()
app.disable('x-powered-by')
app.use(compression())
app.use(cors({origin:ORIGIN==='*'?true:ORIGIN,credentials:false}))
app.get('/healthz',(req,res)=>res.json({ok:true,targetHost:HOST,portRange:[START,END]}))
app.use(netApi({allowOrigin:ORIGIN,timeout:30_000,log:process.env.LOG==='true',to:destinations}))
app.listen(PORT,'0.0.0.0',()=>console.log(`[HEM] websocket TCP proxy :${PORT} -> ${HOST}:${START}-${END}`))
