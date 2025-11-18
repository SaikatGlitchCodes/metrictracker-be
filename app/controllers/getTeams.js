const express = require('express');
const router = express.Router();
const supabaseClient = require('../database/connectionDB');

router.get('/', async(req, res)=>{
    const { data: teams, error } = await supabaseClient.from("teams").select("*").order("name");
    res.json({teams, error});
});

router.get('/:teamId', async(req,res)=>{
    const {teamId} = req.params;
    console.log('teamId',teamId);
    let query = supabaseClient.from("team_members").select(
      `
        *,
        team:teams(*),
        github_user:github_users(*)
      `,
    )
    if (teamId) {
      query = query.eq("team_id", teamId)
    }
    console.log('query', query)
    const { data, error } = await query;
    res.json({data, error});
})

router.post('/add', async(req, res)=>{
    const { name, description } = await req.body();

    if (!name) {
      return res.json({ error: "Team name is required" }, { status: 400 })
    }
    const { data: team, error } = await supabaseClient.from("teams").insert([{ name, description }]).select().single();
    if (error) throw error
     res.json({team, error});

});

module.exports = router;