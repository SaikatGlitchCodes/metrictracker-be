const express = require('express');
const app = express();
const PORT = process.env.PORT || 4000;
const dotenv = require('dotenv');
dotenv.config();
app.use(express.json());

app.get('/', (req, res)=>{
    res.send("Welcome to MetricTracker Backend 🚀")
})

app.use('/teams', require('./controllers/getTeams'));
app.use('/prs', require('./controllers/getPRs'));

app.listen( PORT, ()=>{
    console.log("Server is Running at ", PORT, "🎉")
})