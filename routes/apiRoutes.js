const express = require("express");
const router = express.Router();
const apiController = require("../controllers/apiController");

router.get('/', apiController.allrealtime);
router.get('/site', apiController.realtime);

module.exports = router;