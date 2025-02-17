/**
 * Test that FCV upgrade fails if downgrading fails during isCleaningServerMetadata phase.
 *
 * @tags: [featureFlagDowngradingToUpgrading]
 */

(function() {
"use strict";

load("jstests/libs/fail_point_util.js");
load("jstests/libs/feature_flag_util.js");

const latest = "latest";
const testName = "fcv_upgrade_fails_during_is_cleaning_server_metadata";
const dbpath = MongoRunner.dataPath + testName;

function upgradeFailsDuringIsCleaningServerMetadata(conn, adminDB, replSetTest) {
    assert.commandWorked(conn.adminCommand(
        {configureFailPoint: 'failDowngradingDuringIsCleaningServerMetadata', mode: "alwaysOn"}));
    assert.commandFailed(adminDB.runCommand({setFeatureCompatibilityVersion: lastLTSFCV}));
    let fcvDoc = adminDB.system.version.findOne({_id: 'featureCompatibilityVersion'});
    jsTestLog("Current FCV should be in isCleaningServerMetadata phase: " + tojson(fcvDoc));
    checkFCV(adminDB, lastLTSFCV, lastLTSFCV, true /* isCleaningServerMetadata */);

    // Upgrade should fail because we are in isCleaningServerMetadata.
    assert.commandFailedWithCode(adminDB.runCommand({setFeatureCompatibilityVersion: latestFCV}),
                                 7428200);

    assert.commandWorked(conn.adminCommand(
        {configureFailPoint: 'failDowngradingDuringIsCleaningServerMetadata', mode: "off"}));

    // We are still in isCleaningServerMetadata even if we retry and fail downgrade at an earlier
    // point.
    jsTestLog(
        "Test that retrying downgrade and failing at an earlier point will still keep failing upgrade");
    assert.commandWorked(
        conn.adminCommand({configureFailPoint: 'failDowngrading', mode: "alwaysOn"}));
    assert.commandFailed(adminDB.runCommand({setFeatureCompatibilityVersion: lastLTSFCV}));
    fcvDoc = adminDB.system.version.findOne({_id: 'featureCompatibilityVersion'});
    jsTestLog("Current FCV should still be in isCleaningServerMetadata phase: " + tojson(fcvDoc));
    checkFCV(adminDB, lastLTSFCV, lastLTSFCV, true /* isCleaningServerMetadata */);

    // Upgrade should fail because we are in isCleaningServerMetadata.
    assert.commandFailedWithCode(adminDB.runCommand({setFeatureCompatibilityVersion: latestFCV}),
                                 7428200);

    jsTestLog("isCleaningServerMetadata should persist through restarts.");
    if (replSetTest) {
        replSetTest.stopSet(null /* signal */, true /* forRestart */);
        replSetTest.startSet({restart: true});
        adminDB = replSetTest.getPrimary().getDB("admin");
        conn = replSetTest.getPrimary();
    } else {
        MongoRunner.stopMongod(conn);
        conn = MongoRunner.runMongod({dbpath: dbpath, binVersion: latest, noCleanData: true});
        assert.neq(
            null,
            conn,
            "mongod was unable to start up with version=" + latest + " and existing data files");
        adminDB = conn.getDB("admin");
    }

    fcvDoc = adminDB.system.version.findOne({_id: 'featureCompatibilityVersion'});
    jsTestLog("Current FCV should still be in isCleaningServerMetadata phase: " + tojson(fcvDoc));
    checkFCV(adminDB, lastLTSFCV, lastLTSFCV, true /* isCleaningServerMetadata */);

    // Upgrade should still fail because we are in isCleaningServerMetadata.
    assert.commandFailedWithCode(adminDB.runCommand({setFeatureCompatibilityVersion: latestFCV}),
                                 7428200);

    assert.commandWorked(conn.adminCommand({configureFailPoint: 'failDowngrading', mode: "off"}));

    // Completing downgrade and then upgrading succeeds.
    assert.commandWorked(adminDB.runCommand({setFeatureCompatibilityVersion: lastLTSFCV}));
    checkFCV(adminDB, lastLTSFCV);

    assert.commandWorked(adminDB.runCommand({setFeatureCompatibilityVersion: latestFCV}));
    checkFCV(adminDB, latestFCV);

    if (replSetTest) {
        replSetTest.stopSet();
    } else {
        MongoRunner.stopMongod(conn);
    }
}

function runStandaloneTest() {
    const conn = MongoRunner.runMongod({dbpath: dbpath, binVersion: latest});
    assert.neq(
        null, conn, "mongod was unable to start up with version=" + latest + " and no data files");
    const adminDB = conn.getDB("admin");

    if (!FeatureFlagUtil.isEnabled(adminDB, "DowngradingToUpgrading")) {
        jsTestLog("Skipping as featureFlagDowngradingToUpgrading is not enabled");
        MongoRunner.stopMongod(conn);
        return;
    }

    upgradeFailsDuringIsCleaningServerMetadata(conn, adminDB);

    MongoRunner.stopMongod(conn);
}

function runReplicaSetTest() {
    const rst = new ReplSetTest({nodes: 2, nodeOpts: {binVersion: latest}});
    rst.startSet();
    rst.initiate();
    const primaryAdminDB = rst.getPrimary().getDB("admin");
    const primary = rst.getPrimary();

    if (!FeatureFlagUtil.isEnabled(primaryAdminDB, "DowngradingToUpgrading")) {
        jsTestLog("Skipping as featureFlagDowngradingToUpgrading is not enabled");
        rst.stopSet();
        return;
    }

    upgradeFailsDuringIsCleaningServerMetadata(primary, primaryAdminDB, rst);
}

runStandaloneTest();
runReplicaSetTest();
})();
