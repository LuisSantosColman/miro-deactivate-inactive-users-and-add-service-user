/* 
DISCLAIMER:
The content of this project is subject to the Miro Developer Terms of Use: https://miro.com/legal/developer-terms-of-use/
This script is provided only as an example to illustrate how to identify inactive users in Miro and to deactivate them automatically via API.
The usage of this script is at the sole discretion and responsibility of the customer and is to be tested thoroughly before running it on Production environments.

Script Author: Luis Colman (luis.s@miro.com) | LinkedIn: https://www.linkedin.com/in/luiscolman/
*/

let IS_TEST = true; 
const MIRO_COMPANY_ID = 'YOUR_MIRO_ORGANIZATION_ID';
const SCIM_TOKEN = 'YOUR_MIRO_SCIM_TOKEN';
const REST_TOKEN = 'YOUR_MIRO_REST_API_TOKEN';
const SERVICE_ACCOUNT_EMAIL = 'EMAIL_OF_YOUR_SERVICE_ACCOUNT';
const DAYS_OF_INACTIVITY = NUMBER_OF_DAYS_A_USER_MUST_BE_INACTIVE_TO_BE_ELEGIBLE_FOR_DEACTIVATION; /* add as number/integer (not as a string) */

/* SCRIPT BEGIN */

/* Variables - BEGIN */
const fs = require('fs');
let userObject = {};
let teams = {};
let errorRetryCount = 0;
let numberOfRequests = 52;
let numberOfRequestsForPost = 25;
let affectedTeams = {};
let results = {};
let inactiveUsers = {};
let setRoleOfExistingServiceUserInTeamToAdmin = {};
let teamsToCheckTheRoleOfTheServiceUser = {};
let SERVICE_ACCOUNT_ID = '';

/* Error Obejcts */
let errors = {};
let getIndividualTeamsErrors = {};
let getUsersSCIMErrors = {};
let getUsersOrgErrors = {};
let deactivateUsersSCIMErrors = {};
let log = {
    logEntries: '',
    logBoardVal: ''
};

/* Number of days of inactivity a user must have to be considered "inactive" */
let today = new Date();
let priorDate = new Date().setDate(today.getDate() - DAYS_OF_INACTIVITY)
let lastAcceptedDate = new Date(priorDate).toISOString();

/* Variables - END */

/* Functions - BEGIN */

// Function to add only new keys
function addNewKeys(target, ...sources) {
    sources.forEach(source => {
        Object.keys(source).forEach(key => {
            if (!(key in target)) { // only add if not already present
                target[key] = source[key];
            }
        });
    });
}

/* Function that creates log entries */
function createLogEntry(entryType,entryText,separator,isTestMode) {
    const logSeparator = `==============================================\n`;
    if (log.logEntries === '') {
        log.logEntries += `#### MIRO | DEACTIVATE INACTIVE USERS${isTestMode ? ' (TEST MODE) ' : ' '}- LOG BEGIN ###\n`;
    }
    if (separator) {
        log.logEntries += logSeparator;
    }
    if (entryType === 'info') {
        entryType = 'INFO';
    }
    else if (entryType === 'error') {
        entryType = 'ERROR';
    }
    else if (entryType === 'object') {
        log.logEntries += `${entryText}\n`;
    }
    if (entryType !== 'object') {
        if (entryType === '') {
            log.logEntries += `${entryText}`;
        }
        else {
            log.logEntries += `[${entryType}] ${entryText}\n`;
        }
    }
    if (separator) {
        log.logEntries += logSeparator;
    }
}

function convertTimestampToDate(timestamp) {
    const date = new Date(timestamp); // Convert the 13-digit timestamp to a Date object

    const day = String(date.getDate()).padStart(2, '0'); // Get the day and pad with leading zero if needed
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Get the month (0-based) and pad with leading zero
    const year = date.getFullYear(); // Get the full year

    return `${year}-${month}-${day}`; // Format as YYYY/MM/DD
}

function getStringsBetween(text, start, end) {
    // Create a regular expression dynamically using start and end strings
    var regex = new RegExp(`${start}(.*?)${end}`, 'g');
    var matches = [];
    var match;

    // Iterate over matches found by the regular expression
    while ((match = regex.exec(text)) !== null) {
        // Push the captured group into the matches array
        matches.push(match[1]);
    }
    return matches[0];
}

/* Convert JSON to CSV */
function jsonToCsv(jsonData) {
    if (jsonData) {
        let csv = '';
        
        // Get the headers
        let headers = Object.keys(jsonData[Object.keys(jsonData)[0]]);
        csv += headers.join(',') + '\n';
        
        // Helper function to escape CSV special characters
        const escapeCSV = (value) => {
            if (Array.isArray(value)) {
                // Join array values with a comma followed by a space
                value = value.join(', ');
            }
            if (typeof value === 'string') {
                // Escape double quotes
                if (value.includes('"')) {
                    value = value.replace(/"/g, '""');
                }
            }
            // Wrap the value in double quotes to handle special CSV characters
            value = `"${value}"`;
            return value;
        };
    
        // Add the data
        Object.keys(jsonData).forEach(function(row) {
            let data = headers.map(header => escapeCSV(jsonData[row][header])).join(',');
            csv += data + '\n';
        });

        return csv;
    }
}

function createReportDownloadLink(jsonData,reportName,fileName,parentEl,csv,json) {
    let csvUrl;
    let jsonUrl;
    if (csv) {
        let csvData = jsonToCsv(jsonData);
        // Create a CSV file and allow the user to download it
        let blob = new Blob([csvData], { type: 'text/csv' });
        csvUrl = window.URL.createObjectURL(blob);
    }
    if (json) {
        let jsonString = JSON.stringify(jsonData);
        let blob = new Blob([jsonString], { type: 'application/json' });
        jsonUrl = URL.createObjectURL(blob);
    }

    let div = document.createElement('li');
    div.className = 'bulk_classification_report_item';
    if (csv && json) {
      div.innerHTML = `${reportName} (<a href="${csvUrl}" download="${fileName}.csv">CSV</a> | <a href="${jsonUrl}" download="${fileName}.json">JSON</a>)`;
    }
    else if (csv && !json) {
      div.innerHTML = `${reportName} (<a href="${csvUrl}" download="${fileName}.csv">CSV</a>)`;
    }
    else if (json && !csv) {
      div.innerHTML = `${reportName} (<a href="${jsonUrl}" download="${fileName}.json">JSON</a>)`;
    }
    parentEl.appendChild(div);
}

/* Function to create reports */
function addReportsForNodeJS() {
    createLogEntry('info','Creating reports | function: addReportsForNodeJS ',true,IS_TEST);
    console.log('Creating reports | function: addReportsForNodeJS');
    let content;
    let directory = `miro_deactivate_inactive_users_${convertTimestampToDate(Date.now())}`;
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }

    // Result of deactivation of inactive users
    // content = JSON.stringify(results, null, '2');
    // filePath = `${directory}/inactiveUsers.json`;
    // fs.writeFileSync(filePath, content);

    if (Object.keys(inactiveUsers).length === 0) {
        inactiveUsers = {
            data: {
                result: 'No inactive users found',
                test_mode: (IS_TEST ? 'Yes' : 'No')
            }
        };
    }

    content = jsonToCsv(inactiveUsers);
    filePath = `${directory}/Inactive_Users_Results.csv`;
    fs.writeFileSync(filePath, content);

    // Report of affected teams (Affected teams are teams where the last Team Admin is one of the users to deactivate)
    // content = JSON.stringify(teamsToRemove, null, '2');
    // filePath = `${directory}/affectedTeams.json`;
    // fs.writeFileSync(filePath, content);

    if (Object.keys(affectedTeams).length === 0) {
        affectedTeams = {
            data: {
                result: 'No Teams that required the Service User to be added were identified. This means either the Service User is already a Team Admin on the teams in question or the users to deactivate are not the last Team Admin on any of the teams',
                test_mode: (IS_TEST ? 'Yes' : 'No')
            }
        };
    }

    content = jsonToCsv(affectedTeams);
    filePath = `${directory}/Affected_Teams_that_required_Service_User.csv`;
    fs.writeFileSync(filePath, content);

    addNewKeys(errors, getIndividualTeamsErrors, getUsersSCIMErrors, getUsersOrgErrors, deactivateUsersSCIMErrors);

    if (Object.keys(errors).length > 0) {
        // content = JSON.stringify(errors, null, '2');
        // filePath = `${directory}/errors.json`;
        // fs.writeFileSync(filePath, content);

        content = jsonToCsv(errors);
        filePath = `${directory}/Script_Errors.csv`;
        fs.writeFileSync(filePath, content);
        createLogEntry('info','Errors found. Please review the Script_Errors.csv file for details | function: addReportsForNodeJS ',true,IS_TEST);
    }

    createLogEntry('info','Reports created. You will find them in the folder "miro_deactivate_inactive_users" in the same directory as this script | function: addReportsForNodeJS ',true,IS_TEST);
    createLogEntry('info',`Script end time: ${new Date()}`,true,IS_TEST);
    createLogEntry('info','*********** END OF SCRIPT **********',true,IS_TEST);
    console.log('Reports created. You will find them in the folder "miro_deactivate_inactive_users" in the same directory as this script | function: addReportsForNodeJS');

    filePath = `${directory}/Script_Logs.txt`;
    fs.writeFileSync(filePath, log.logEntries, 'utf8');
}

/* Function to call Miro API teams */
async function callAPI(url, options) {
    async function manageErrors(response) {
        if(!response.ok){
            var parsedResponse = await response.json();
            var responseError = {
                status: response.status,
                statusText: response.statusText,
                requestUrl: response.url,
                errorDetails: parsedResponse
            };
            throw(responseError);
        }
        return response;
    }

    var response = await fetch(url, options)
    .then(manageErrors)
    .then((res) => {
        if (res.ok) {
            var rateLimitRemaining = res.headers.get('X-RateLimit-Remaining');
            return res[res.status == 204 ? 'text' : 'json']().then((data) => ({ status: res.status, rate_limit_remaining: rateLimitRemaining, body: data }));
        }
    })
    .catch((error) => {
        console.error('Error:', error);
        return error;
    });
    return response;
}

/* Function to add Service Account as Team Admin */
async function changeRoleOfServiceUserInTeam(numberOfRequestsForPost) {
    createLogEntry('info','Setting the Service User as Team Admin in affected teams | function: changeRoleOfServiceUserInTeam ',true,IS_TEST);
    if (IS_TEST) {
        createLogEntry('info','Setting the Service User as Team Admin in affected teams skipped (TEST MODE is ON) | function: changeRoleOfServiceUserInTeam ',true,IS_TEST);
        return false;
    }

    let totalItems;
    let batchUrls;
    let getRemainingTeams;
    let getProcessedTeams;

    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + REST_TOKEN
    };

    let payload = JSON.stringify({
        role: 'admin'
    });

    let reqGetOptions = {
        method: 'PATCH',
        headers: reqHeaders,
        body: payload
    };

    totalItems = Object.keys(setRoleOfExistingServiceUserInTeamToAdmin);
    getRemainingTeams = {};

    for(let i=0; i < totalItems.length; i++) {
        getRemainingTeams[totalItems[i]] = { team_id: totalItems[i].team_id }
    }

    getProcessedTeams = {};
    let processedUrls = [];
    let batchSize;

    while (Object.keys(getRemainingTeams).length > 0) {
        var apiUrl = `https://api.miro.com/v2/orgs/${MIRO_COMPANY_ID}/teams`;
        
        // Calculate the number of items remaining to fetch
        const remainingItems = totalItems.length - (Object.keys(getProcessedTeams).length);

        if (Object.keys(getIndividualTeamsErrors).length === 0) {
            // Calculate the number of calls to make in this batch
            batchSize = Math.min(numberOfRequestsForPost, Math.ceil(remainingItems / 1));
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${apiUrl}/${Object.keys(getRemainingTeams)[index]}/members/${SERVICE_ACCOUNT_ID}`);
        }
        else {
            console.log('Errors found - retrying failed requests');
            createLogEntry('info','Errors found - retrying failed requests | function: changeRoleOfServiceUserInTeam ',true,IS_TEST);
            //if (getIndividualTeamsErrors[Object.keys(getIndividualTeamsErrors)[Object.keys(getIndividualTeamsErrors).length - 1]].error == 429) { 
                await holdScriptExecution(61000); 
                batchSize = Object.keys(getIndividualTeamsErrors).length;
                batchUrls = Array.from({ length: batchSize }, (_, index) => `${Object.keys(getIndividualTeamsErrors)[index]}`);
                processedUrls.forEach(function(item) {
                    let urlIndex = batchUrls.indexOf(item);
                    if (urlIndex !== -1) {
                        batchUrls.splice(urlIndex, 1);
                    }
                });
                errorRetryCount = errorRetryCount + 1;
                console.log(`errorRetryCount --> ${errorRetryCount}`);
                createLogEntry('info',`Errors found - errorRetryCount --> ${errorRetryCount} | function: changeRoleOfServiceUserInTeam `,true,IS_TEST);
                if (errorRetryCount < 13) {
                    if (errorRetryCount === 12) { 
                        createLogEntry('info',`This is the 12th and last attempt to retry failed "changeRoleOfServiceUserInTeam" calls | function: changeRoleOfServiceUserInTeam `,true,IS_TEST);
                        console.log('This is the 12th and last attempt to retry failed "changeRoleOfServiceUserInTeam" calls...');
                    }
                }
                else {
                    createLogEntry('info',`Maximum amount of retry attempts for failed "getTeamAdmins" calls reached (7). Please review the "getIndividualTeamsErrors" object to find out what the problem is... | function: changeRoleOfServiceUserInTeam `,true,IS_TEST);
                    console.log('Maximum amount of retry attempts for failed "getTeamAdmins" calls reached (7). Please review the "getIndividualTeamsErrors" object to find out what the problem is...');
                    return false;
                }
            //}
        }
        if (Object.keys(getIndividualTeamsErrors).length > 0) {
            createLogEntry('info',`Failed API calls to retry below: ----- | function: changeRoleOfServiceUserInTeam `,true,IS_TEST);
            console.log(`Failed API calls to retry below: -----`); 
        }

        if (batchUrls.length > 0) {
            createLogEntry('info',`Failed API calls to retry below: ----- | function: changeRoleOfServiceUserInTeam `,true,IS_TEST);
            createLogEntry('object',JSON.stringify(batchUrls, null, 2),true,IS_TEST);

            console.log(`.........API URLs in this the batch are:`);
            console.table(batchUrls);

            try {       
                const promisesWithUrls = batchUrls.map(url => {
                    const promise = fetch(url, reqGetOptions)
                        .catch(error => {
                            // Check if the error is a response error
                            if (error instanceof Response) {
                                // Capture the HTTP error code and throw it as an error
                                let teamId = getStringsBetween(value.url, 'teams/', '/members');
                                if (!getIndividualTeamsErrors[url]) {
                                    getIndividualTeamsErrors[url] = { url: url, info: `Promise fetch call failed | function: changeRoleOfServiceUserInTeam | team: ${teamId} | errorMessage: ${error.statusText}`, error: `${error.status}` };
                                }
                                console.error({ team: teamId, url: url, errorMessage: errorMessage });
                                return Promise.reject(error);
                            } else {
                                // For other types of errors, handle them as usual
                                throw error;
                            }
                        });
                    return { promise, url };
                });

                // Fetch data for each URL in the batch
                const batchResponses = await Promise.allSettled(promisesWithUrls.map(({ promise }) => promise));
                for (let i = 0; i < batchResponses.length; i++) {
                    let { status, value, reason } = batchResponses[i];
                    let teamId = value.url.split('/');
                    teamId = teamId[7];
                    if (status === 'fulfilled') {
                        if (value.ok) {
                            errorRetryCount = 0;
                            if (processedUrls.indexOf(value.url) === -1) {
                                let batchData = await value.json();
                                teamId = batchData.teamId.toString();
                                affectedTeams[teamId].result = `Service Account "${SERVICE_ACCOUNT_EMAIL}" successfully added to the Team as Team Admin`;
                                processedUrls.push(value.url);
                                delete getRemainingTeams[teamId];
                                if (!getProcessedTeams[teamId]) {
                                    getProcessedTeams[teamId] = { team_id: teamId, team_name: teams[teamId].team_name };
                                }
                                if (getIndividualTeamsErrors[value.url]) {
                                    delete getIndividualTeamsErrors[value.url];
                                }
                                createLogEntry('info',`Service Account successfully added to Team ${teamId} - Team ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId} | function: changeRoleOfServiceUserInTeam `,true,IS_TEST);
                                console.log(`Service Account successfully added to Team ${teamId} - Team ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId}`);
                            }
                        }
                        else if (value.status === 429) {
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { url: value.url, info: 'Rate limit hit | function: changeRoleOfServiceUserInTeam', error: value.status };
                            }
                        }
                        else {
                            let batchData = await value.json();
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { url: value.url, info: `API call error | function: changeRoleOfServiceUserInTeam | "${JSON.stringify(batchData)}"`, error: `${value.status}` };
                            }
                            processedUrls.push(value.url);
                            delete getRemainingTeams[teamId];
                            if (!getProcessedTeams[teamId]) {
                                getProcessedTeams[teamId] = { team_id: teamId, team_name: teams[teamId].team_name };
                            }
                            if (getIndividualTeamsErrors[value.url]) {
                                delete getIndividualTeamsErrors[value.url];
                            }
                            createLogEntry('info',`Error - Could not add Service Account to Team - Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId} | function: changeRoleOfServiceUserInTeam`,true,IS_TEST);
                            console.log(`Error - Could not add Service Account to Team - Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId}`);
                            console.dir(batchData);
                        }
                    }
                    else {
                        let index = batchResponses.indexOf({ status, value, reason });
                        let failedUrl = promisesWithUrls[index].url;
                        if (!getIndividualTeamsErrors[failedUrl]) {
                            getIndividualTeamsErrors[failedUrl] = { url: failedUrl, info: `Promise fetch call failed | function: changeRoleOfServiceUserInTeam | team: ${teamId} | errorMessage: ${value?.statusText} | function: changeRoleOfServiceUserInTeam`, error: status };
                        }
                        createLogEntry('info',`Promise fetch call failed | function: changeRoleOfServiceUserInTeam | team: ${teamId} | errorMessage: ${value?.statusText} | error: ${status} | function: changeRoleOfServiceUserInTeam`,true,IS_TEST);
                        console.error(`Promise fetch call failed - API URL --> ${failedUrl}:`, reason);
                    }
                }

            }
            catch (error) {
                createLogEntry('info',`Errors = ${error} | function: changeRoleOfServiceUserInTeam`,false,IS_TEST);
                console.error(error);
            }
        }
    }
    createLogEntry('info','Setting the Service User as Team Admin in affected teams COMPLETE | function: changeRoleOfServiceUserInTeam ',true,IS_TEST);
}

/* Function to add Service Account as Team Admin */
async function inviteServiceAccountAsTeamAdmin(numberOfRequestsForPost) {
    createLogEntry('info','Adding Service User to affected teams | function: inviteServiceAccountAsTeamAdmin ',true,IS_TEST);
    if (IS_TEST) {
        createLogEntry('info','Adding Service User to affected teams skipped (TEST MODE is ON)| function: inviteServiceAccountAsTeamAdmin ',true,IS_TEST);
        return false;
    }

    let totalItems;
    let batchUrls;
    let getRemainingTeams;
    let getProcessedTeams;

    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + REST_TOKEN
    };

    let payload = JSON.stringify({
        email: SERVICE_ACCOUNT_EMAIL.toLowerCase(), 
        role: 'admin'
    });

    let reqGetOptions = {
        method: 'POST',
        headers: reqHeaders,
        body: payload
    };

    totalItems = Object.keys(affectedTeams);
    getRemainingTeams = {};

    for(let i=0; i < totalItems.length; i++) {
        getRemainingTeams[totalItems[i]] = { team_name: totalItems[i].team_name, team_id: totalItems[i].team_id }
    }

    getProcessedTeams = {};
    let processedUrls = [];
    let batchSize;

    while (Object.keys(getRemainingTeams).length > 0) {
        var apiUrl = `https://api.miro.com/v2/orgs/${MIRO_COMPANY_ID}/teams`;
        
        // Calculate the number of items remaining to fetch
        const remainingItems = totalItems.length - (Object.keys(getProcessedTeams).length);

        if (Object.keys(getIndividualTeamsErrors).length === 0) {
            // Calculate the number of calls to make in this batch
            batchSize = Math.min(numberOfRequestsForPost, Math.ceil(remainingItems / 1));
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${apiUrl}/${Object.keys(getRemainingTeams)[index]}/members`);
        }
        else {
            createLogEntry('info',`Errors found - retrying failed requests | function: inviteServiceAccountAsTeamAdmin`,false,IS_TEST);
            console.log('Errors found - retrying failed requests');
            //if (getIndividualTeamsErrors[Object.keys(getIndividualTeamsErrors)[Object.keys(getIndividualTeamsErrors).length - 1]].error == 429) { 
                await holdScriptExecution(61000); 
                batchSize = Object.keys(getIndividualTeamsErrors).length;
                batchUrls = Array.from({ length: batchSize }, (_, index) => `${Object.keys(getIndividualTeamsErrors)[index]}`);
                processedUrls.forEach(function(item) {
                    let urlIndex = batchUrls.indexOf(item);
                    if (urlIndex !== -1) {
                        batchUrls.splice(urlIndex, 1);
                    }
                });
                errorRetryCount = errorRetryCount + 1;
                console.log(`errorRetryCount --> ${errorRetryCount}`);
                if (errorRetryCount < 13) {
                    if (errorRetryCount === 12) {
                        createLogEntry('info',`This is the 12th and last attempt to retry failed "getTeamAdmins" calls | function: inviteServiceAccountAsTeamAdmin`,false,IS_TEST);
                        console.log('This is the 12th and last attempt to retry failed "getTeamAdmins" calls...');
                    }
                }
                else {
                    createLogEntry('info',`Maximum amount of retry attempts for failed "getTeamAdmins" calls reached (7). Please review the "getIndividualTeamsErrors" object to find out what the problem is | function: inviteServiceAccountAsTeamAdmin`,false,IS_TEST);
                    console.log('Maximum amount of retry attempts for failed "getTeamAdmins" calls reached (7). Please review the "getIndividualTeamsErrors" object to find out what the problem is...');
                    return false;
                }
            //}
        }
        if (Object.keys(getIndividualTeamsErrors).length > 0) { 
            createLogEntry('info',`Failed API calls to retry below: ----- | function: inviteServiceAccountAsTeamAdmin`,false,IS_TEST);
            console.log(`Failed API calls to retry below: -----`); 
        }

        if (batchUrls.length > 0) {
            createLogEntry('info',`.........API URLs in this the batch are: | function: inviteServiceAccountAsTeamAdmin`,false,IS_TEST);
            console.log(`.........API URLs in this the batch are:`);
            
            createLogEntry('object',JSON.stringify(batchUrls, null, 2),true,IS_TEST);
            console.table(batchUrls);

            try {       
                const promisesWithUrls = batchUrls.map(url => {
                    const promise = fetch(url, reqGetOptions)
                        .catch(error => {
                            // Check if the error is a response error
                            if (error instanceof Response) {
                                // Capture the HTTP error code and throw it as an error
                                let teamId = getStringsBetween(value.url, 'teams/', '/members');
                                if (!getIndividualTeamsErrors[url]) {
                                    getIndividualTeamsErrors[url] = { url: url, info: `Promise fetch call failed | function: inviteServiceAccountAsTeamAdmin | team: ${teamId}, errorMessage: ${error.statusText}`, error: error.status };
                                }
                                console.error({ team: teamId, url: url, errorMessage: errorMessage });
                                return Promise.reject(error);
                            } else {
                                // For other types of errors, handle them as usual
                                throw error;
                            }
                        });
                    return { promise, url };
                });

                // Fetch data for each URL in the batch
                const batchResponses = await Promise.allSettled(promisesWithUrls.map(({ promise }) => promise));
                for (let i = 0; i < batchResponses.length; i++) {
                    let { status, value, reason } = batchResponses[i];
                    let teamId = value.url.split('/');
                    teamId = teamId[7];
                    if (status === 'fulfilled') {
                        if (value.ok) {
                            errorRetryCount = 0;
                            if (processedUrls.indexOf(value.url) === -1) {
                                let batchData = await value.json();
                                affectedTeams[teamId].result = `Service Account "${SERVICE_ACCOUNT_EMAIL}" successfully added to the Team as Team Admin`;
                                processedUrls.push(value.url);
                                delete getRemainingTeams[teamId];
                                if (!getProcessedTeams[teamId]) {
                                    getProcessedTeams[teamId] = { team_id: teamId, team_name: teams[teamId].team_name };
                                }
                                if (getIndividualTeamsErrors[value.url]) {
                                    delete getIndividualTeamsErrors[value.url];
                                }
                                createLogEntry('info',`Service Account successfully added to Team ${teamId} - Team ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId} | function: inviteServiceAccountAsTeamAdmin`,true,IS_TEST);
                                console.log(`Service Account successfully added to Team ${teamId} - Team ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId}`);
                            }
                        }
                        else if (value.status === 409) {
                            let batchData = await value.json();
                            if (batchData?.message === 'User already exists in the account') {
                                errorRetryCount = 0;
                                delete getRemainingTeams[teamId];
                                if (processedUrls.indexOf(value.url) === -1) {
                                    processedUrls.push(value.url);
                                }
                                if (!getProcessedTeams[teamId]) {
                                    getProcessedTeams[teamId] = { team_id: teamId };
                                }
                                if (!teamsToCheckTheRoleOfTheServiceUser[teamId]) {
                                    teamsToCheckTheRoleOfTheServiceUser[teamId] = { team_id: teamId };
                                }
                                if (getIndividualTeamsErrors[value.url]) {
                                    delete getIndividualTeamsErrors[value.url];
                                }
                            }
                            else {
                                if (!getIndividualTeamsErrors[value.url]) {
                                    getIndividualTeamsErrors[value.url] = { url: value.url, info: `API call error | function: inviteServiceAccountAsTeamAdmin | team_id: ${teamId} | team_name: ${teams[teamId].team_name}`, error: value.status };
                                }
                            }
                        }
                        else if (value.status === 429) {
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { url: value.url, info: 'Rate limit hit | function: inviteServiceAccountAsTeamAdmin', error: value.status };
                            }
                        }
                        else {
                            let batchData = await value.json();
                            if (!getIndividualTeamsErrors[teamId]) {
                                getIndividualTeamsErrors[teamId] = { url: value.url, info: `API call error | function: inviteServiceAccountAsTeamAdmin | team_id: ${teamId} | team_name: ${teams[teamId].team_name} | "${JSON.stringify(batchData)}"`, error: value.status };
                            }
                            processedUrls.push(value.url);
                            delete getRemainingTeams[teamId];
                            if (!getProcessedTeams[teamId]) {
                                getProcessedTeams[teamId] = { team_id: teamId, team_name: teams[teamId].team_name };
                            }
                            if (getIndividualTeamsErrors[value.url]) {
                                delete getIndividualTeamsErrors[value.url];
                            }
                            createLogEntry('info',`Error - Could not add Service Account to Team - Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId} | function: inviteServiceAccountAsTeamAdmin`,true,IS_TEST);
                            console.log(`Error - Could not add Service Account to Team - Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId}`);
                            console.dir(batchData);
                        }
                    }
                    else {
                        let index = batchResponses.indexOf({ status, value, reason });
                        let failedUrl = promisesWithUrls[index].url;
                        if (!getIndividualTeamsErrors[failedUrl]) {
                            getIndividualTeamsErrors[failedUrl] = { url: failedUrl, info: `Promise fetch call failed | function: inviteServiceAccountAsTeamAdmin | team: ${teamId} | errorMessage: ${value.statusText}`, error: status };
                        }
                        createLogEntry('info',`Promise fetch call failed | function: inviteServiceAccountAsTeamAdmin | team: ${teamId} | errorMessage: ${value.statusText} | error: ${status} | function: inviteServiceAccountAsTeamAdmin`,true,IS_TEST);
                        console.error(`Promise fetch call failed - API URL --> ${failedUrl}:`, reason);
                    }
                }

            }
            catch (error) {
                createLogEntry('info',`Error - ${error} | function: inviteServiceAccountAsTeamAdmin`,true,IS_TEST);
                console.error(error);
            }
        }
    }

    if (Object.keys(getIndividualTeamsErrors).length === 0) {
        if (Object.keys(teamsToCheckTheRoleOfTheServiceUser).length !== 0) {
            await checkRoleOfServiceUser(52);
        }
        else {
            createLogEntry('info','Adding Service User to affected teams COMPLETE | function: inviteServiceAccountAsTeamAdmin ',true,IS_TEST);
        }
    }
}

/* Function to get Team Admins */
async function checkRoleOfServiceUser(numberOfRequests) {
    createLogEntry('info','Checking the role of the Service User in the affected Teams | function: checkRoleOfServiceUser ',true,IS_TEST);
    let totalItems;
    let batchUrls;
    let getRemainingTeams;
    let getProcessedTeams;

    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + REST_TOKEN
    };

    let reqGetOptions = {
        method: 'GET',
        headers: reqHeaders,
        body: null
    };

    let initialData = [];
    totalItems = Object.keys(teamsToCheckTheRoleOfTheServiceUser);
    getRemainingTeams = {};

    for(let i=0; i < totalItems.length; i++) {
        getRemainingTeams[totalItems[i]] = { team_name: totalItems[i].team_name, team_id: totalItems[i].team_id }
    }

    getProcessedTeams = {};
    let processedUrls = [];
    let batchSize;

    while (Object.keys(getRemainingTeams).length > 0) {
        createLogEntry('info',`----- Checking the Role of the Service User in affected team - Remaining ${Object.keys(getRemainingTeams).length}`,true,IS_TEST);
        console.log(`----- Checking the Role of the Service User in affected team - Remaining ${Object.keys(getRemainingTeams).length}`);
        var apiUrl = `https://api.miro.com/v2/orgs/${MIRO_COMPANY_ID}/teams`;
        
        // Calculate the number of items remaining to fetch
        const remainingItems = totalItems.length - (Object.keys(getProcessedTeams).length);

        if (Object.keys(getIndividualTeamsErrors).length === 0) {
            // Calculate the number of calls to make in this batch
            batchSize = Math.min(numberOfRequests, Math.ceil(remainingItems / 1));
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${apiUrl}/${Object.keys(getRemainingTeams)[index]}/members/${SERVICE_ACCOUNT_ID}`);
        }
        else {
            console.log('Errors found - retrying failed requests');
            await holdScriptExecution(61000); 
            batchSize = Object.keys(getIndividualTeamsErrors).length;
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${Object.keys(getIndividualTeamsErrors)[index]}`);
            processedUrls.forEach(function(item) {
                let urlIndex = batchUrls.indexOf(item);
                if (urlIndex !== -1) {
                    batchUrls.splice(urlIndex, 1);
                }
            });
            errorRetryCount = errorRetryCount + 1;
            console.log(`errorRetryCount --> ${errorRetryCount}`);
            if (errorRetryCount < 13) {
                if (errorRetryCount === 12) {
                    createLogEntry('info',`This is the 7th and last attempt to retry failed "checkRoleOfServiceUser" calls | function: checkRoleOfServiceUser`,true,IS_TEST);
                    console.log('This is the 7th and last attempt to retry failed "checkRoleOfServiceUser" calls...');
                }
            }
            else {
                createLogEntry('info',`Maximum amount of retry attempts for failed "checkRoleOfServiceUser" calls reached (7). Please review the "checkRoleOfServiceUser" object to find out what the problem is. | function: checkRoleOfServiceUser`,true,IS_TEST);
                console.log('Maximum amount of retry attempts for failed "checkRoleOfServiceUser" calls reached (7). Please review the "checkRoleOfServiceUser" object to find out what the problem is...');
                return false;
            }
        }
        if (Object.keys(getIndividualTeamsErrors).length > 0) { 
            createLogEntry('info',`Failed API calls to retry below: -----`,false,IS_TEST);
            console.log(`Failed API calls to retry below: -----`); 
        }
        if (batchUrls.length > 0) {
            createLogEntry('info',`.........API URLs in this the batch are:`,false,IS_TEST);
            console.log(`.........API URLs in this the batch are:`);

            createLogEntry('object',JSON.stringify(batchUrls, null, 2),true,IS_TEST);
            console.table(batchUrls);
            try {       
                const promisesWithUrls = batchUrls.map(url => {
                    const promise = fetch(url, reqGetOptions)
                        .catch(error => {
                            // Check if the error is a response error
                            if (error instanceof Response) {
                                // Capture the HTTP error code and throw it as an error
                                let teamId = getStringsBetween(value.url, 'teams/', '/members');
                                if (!getIndividualTeamsErrors[url]) {
                                    getIndividualTeamsErrors[url] = { url: url, info: `Promise fetch call failed | function: checkRoleOfServiceUser | team: ${teamId} | errorMessage: ${error.statusText}`, error: error.status };
                                }
                                console.error({ team: teamId, url: url, errorMessage: errorMessage });
                                return Promise.reject(error);
                            } else {
                                // For other types of errors, handle them as usual
                                throw error;
                            }
                        });
                    return { promise, url };
                });

                // Fetch data for each URL in the batch
                const batchResponses = await Promise.allSettled(promisesWithUrls.map(({ promise }) => promise));
                for (let i = 0; i < batchResponses.length; i++) {
                    let { status, value, reason } = batchResponses[i];
                    if (status === 'fulfilled') {
                        if (value.ok) {
                            errorRetryCount = 0;
                            if (value.status === 200) {
                                let teamId = getStringsBetween(value.url, 'teams/', '/members');
                                let batchData = await value.json();
                                if (batchData?.role !== 'admin') {
                                    if (!setRoleOfExistingServiceUserInTeamToAdmin[teamId]) {
                                        setRoleOfExistingServiceUserInTeamToAdmin[teamId] = { team_id: teamId };
                                    }
                                }
                                if (processedUrls.indexOf(value.url) === -1) { processedUrls.push(value.url) };
                                delete getRemainingTeams[teamId];
                                if (!getProcessedTeams[teamId]) {
                                    getProcessedTeams[teamId] = { team_id: teamId };
                                }
                                if (getIndividualTeamsErrors[value.url]) {
                                    delete getIndividualTeamsErrors[value.url];
                                }
                                createLogEntry('info',`Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId} | function: getTeamAdmins`,true,IS_TEST);
                                console.log(`Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId}`);
                            }
                        }
                        else if (value.status === 429) {
                            let teamId = getStringsBetween(value.url, 'teams/', '/members');
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { url: value.url, info: `Rate limit hit | function: checkRoleOfServiceUser`, error: value.status };
                            }
                        }
                        else {
                            let teamId = getStringsBetween(value.url, 'teams/', '/members');
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { url: value.url, info: `Rate limit hit | function: checkRoleOfServiceUser | team_id: ${teamId} | team_name: ${teams[teamId].team_name}`, error: value.status };
                            }
                        }
                    }
                    else {
                        let index = batchResponses.indexOf({ status, value, reason });
                        let failedUrl = promisesWithUrls[index].url;
                        let teamId = getStringsBetween(failedUrl, 'teams/', '/members');
                        if (!getIndividualTeamsErrors[failedUrl]) {
                            getIndividualTeamsErrors[failedUrl] = { url: failedUrl, info: `Promise fetch call failed | function: checkRoleOfServiceUser | team: ${teamId}, errorMessage: ${value.statusText}`, error: status };
                        }
                        createLogEntry('info',`Promise fetch call failed | function: checkRoleOfServiceUser | team: ${teamId}, errorMessage: ${value.statusText} | error: ${status} | function: checkRoleOfServiceUser`,true,IS_TEST);
                        console.error(`Promise fetch call failed - API URL --> ${failedUrl}:`, reason);
                    }
                }

            }
            catch (error) {
                createLogEntry('info',`${error} | function: checkRoleOfServiceUser`,true,IS_TEST);
                console.error(error);
            }
        }
    }
    if (Object.keys(getIndividualTeamsErrors).length === 0) {
        if (Object.keys(setRoleOfExistingServiceUserInTeamToAdmin).length > 0) {
            await changeRoleOfServiceUserInTeam(52);
        }
        else {
            createLogEntry('info','Checking the role of the Service User in the affected Teams COMPLETE | function: checkRoleOfServiceUser ',true,IS_TEST);
        }
    }
}


/* Function to get Team Admins */
async function getTeamAdmins(numberOfRequests) {
    createLogEntry('info','Getting Team Admins | function: getTeamAdmins ',true,IS_TEST);
    let totalItems;
    let batchUrls;
    let getRemainingTeams;
    let getProcessedTeams;

    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + REST_TOKEN
    };

    let reqGetOptions = {
        method: 'GET',
        headers: reqHeaders,
        body: null
    };

    let initialData = [];
    totalItems = Object.keys(teams);
    getRemainingTeams = {};

    for(let i=0; i < totalItems.length; i++) {
        getRemainingTeams[totalItems[i]] = { team_name: totalItems[i].team_name, team_id: totalItems[i].team_id }
    }

    getProcessedTeams = {};
    let processedUrls = [];
    let batchSize;

    while (Object.keys(getRemainingTeams).length > 0) {
        createLogEntry('info',`----- Getting Team Admins - Remaining ${Object.keys(getRemainingTeams).length} | function: getTeamAdmins`,true,IS_TEST);
        console.log(`----- Getting Team Admins - Remaining ${Object.keys(getRemainingTeams).length}`);
        var apiUrl = `https://api.miro.com/v2/orgs/${MIRO_COMPANY_ID}/teams`;
        
        // Calculate the number of items remaining to fetch
        const remainingItems = totalItems.length - (Object.keys(getProcessedTeams).length);

        if (Object.keys(getIndividualTeamsErrors).length === 0) {
            // Calculate the number of calls to make in this batch
            batchSize = Math.min(numberOfRequests, Math.ceil(remainingItems / 1));
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${apiUrl}/${Object.keys(getRemainingTeams)[index]}/members?role=admin`);
        }
        else {
            createLogEntry('info',`Errors found - retrying failed requests | function: getTeamAdmins`,true,IS_TEST);
            console.log('Errors found - retrying failed requests');
            await holdScriptExecution(61000); 
            batchSize = Object.keys(getIndividualTeamsErrors).length;
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${Object.keys(getIndividualTeamsErrors)[index]}`);
            processedUrls.forEach(function(item) {
                let urlIndex = batchUrls.indexOf(item);
                if (urlIndex !== -1) {
                    batchUrls.splice(urlIndex, 1);
                }
            });
            errorRetryCount = errorRetryCount + 1;
            createLogEntry('info',`errorRetryCount --> ${errorRetryCount} | function: getTeamAdmins`,true,IS_TEST);
            console.log(`errorRetryCount --> ${errorRetryCount}`);
            if (errorRetryCount < 13) {
                if (errorRetryCount === 12) {
                    createLogEntry('info',`This is the 7th and last attempt to retry failed "getTeamAdmins" calls | function: getTeamAdmins`,true,IS_TEST);
                    console.log('This is the 7th and last attempt to retry failed "getTeamAdmins" calls...');
                }
            }
            else {
                createLogEntry('info',`Maximum amount of retry attempts for failed "getTeamAdmins" calls reached (7). Please review the "getIndividualTeamsErrors" object to find out what the problem is | function: getTeamAdmins`,true,IS_TEST);
                console.log('Maximum amount of retry attempts for failed "getTeamAdmins" calls reached (7). Please review the "getIndividualTeamsErrors" object to find out what the problem is...');
                return false;
            }
        }
        if (Object.keys(getIndividualTeamsErrors).length > 0) { 
            console.log(`Failed API calls to retry below: -----`); 
        }
        if (batchUrls.length > 0) {
            console.log(`.........API URLs in this the batch are:`);
            console.table(batchUrls);
            try {       
                const promisesWithUrls = batchUrls.map(url => {
                    const promise = fetch(url, reqGetOptions)
                        .catch(error => {
                            // Check if the error is a response error
                            if (error instanceof Response) {
                                // Capture the HTTP error code and throw it as an error
                                let teamId = getStringsBetween(value.url, 'teams/', '/members');
                                if (!getIndividualTeamsErrors[url]) {
                                    getIndividualTeamsErrors[url] = { url: value.url, info: `Promise fetch call failed | function: getTeamAdmins | team: ${teamId}, errorMessage: ${error.statusText}`, error: error.status };
                                }
                                console.error({ team: teamId, url: url, errorMessage: errorMessage });
                                return Promise.reject(error);
                            } else {
                                // For other types of errors, handle them as usual
                                throw error;
                            }
                        });
                    return { promise, url };
                });

                // Fetch data for each URL in the batch
                const batchResponses = await Promise.allSettled(promisesWithUrls.map(({ promise }) => promise));
                for (let i = 0; i < batchResponses.length; i++) {
                    let { status, value, reason } = batchResponses[i];
                    if (status === 'fulfilled') {
                        if (value.ok) {
                            errorRetryCount = 0;
                            if (value.status === 200) {
                                let teamId = getStringsBetween(value.url, 'teams/', '/members');
                                let batchData = await value.json();
                                if (batchData.data.length > 0) {
                                    for(let i=0; i < batchData.data.length; i++) {
                                        if (userObject[batchData.data[i].id]) {
                                            teams[teamId].team_admins.push(userObject[batchData.data[i].id].user_email);
                                        }
                                    }
                                }
                                if (!teamId) { teamId = getStringsBetween(value.url, 'teams/', '/members'); }
                                if (processedUrls.indexOf(value.url) === -1) { processedUrls.push(value.url) };
                                delete getRemainingTeams[teamId];
                                if (!getProcessedTeams[teamId]) {
                                    getProcessedTeams[teamId] = { team_id: teamId, team_name: teams[teamId].team_name };
                                }
                                if (getIndividualTeamsErrors[value.url]) {
                                    delete getIndividualTeamsErrors[value.url];
                                }
                                createLogEntry('info',`Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId} | function: getTeamAdmins`,true,IS_TEST);
                                console.log(`Processed teams: ${Object.keys(getProcessedTeams).length} out of ${totalItems.length} - Current Team: ${teamId} | function: getTeamAdmins`);
                            }
                        }
                        else if (value.status === 429) {
                            let teamId = getStringsBetween(value.url, 'teams/', '/members');
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { url: value.url, info: `Rate Limit hit | function: getTeamAdmins | team_id: ${teamId}, team_name: ${teams[teamId].team_name}`, error: value.status };
                            }
                        }
                        else {
                            let teamId = getStringsBetween(value.url, 'teams/', '/members');
                            if (!getIndividualTeamsErrors[value.url]) {
                                getIndividualTeamsErrors[value.url] = { url: value.url, info: `API call error | function: getTeamAdmins | team_id: ${teamId}, team_name: ${teams[teamId].team_name}`, error: value.status };
                            }
                        }
                    }
                    else {
                        let index = batchResponses.indexOf({ status, value, reason });
                        let failedUrl = promisesWithUrls[index].url;
                        let teamId = getStringsBetween(failedUrl, 'teams/', '/members');
                        if (!getIndividualTeamsErrors[failedUrl]) {
                            getIndividualTeamsErrors[failedUrl] = { url: failedUrl, info: `Promise fetch call failed | function: getTeamAdmins | team_id: ${teamId} | errorMessage: ${value.statusText}`, error: status };
                        }
                        createLogEntry('info',`Promise fetch call failed | function: getTeamAdmins | team_id: ${teamId} | errorMessage: ${value.statusText} | error: status`,true,IS_TEST);
                        console.error(`Promise fetch call failed - API URL --> ${failedUrl}:`, reason);
                    }
                }

            }
            catch (error) {
                console.error(error);
            }
        }
    }
    return true;
}


/* Function to get affected teams */
async function getAffectedTeams(users, teams) {
    console.log('Checking affected teams that need the Service Account as Team Admin...');
    createLogEntry('info','Checking affected teams that need the Service Account as Team Admin | function: getAffectedTeams ',true,IS_TEST);
    const userTeamMap = new Map();

    // Step 1: Create a Map with user ID as the key and an array of team objects they belong to as the value
    for (const team of Object.values(teams)) {
        for (const admin of team.team_admins) {
            if (!userTeamMap.has(admin)) {
                userTeamMap.set(admin, []);
            }
            userTeamMap.get(admin).push(team);
        }
    }

    // Step 2: Check which teams are associated with the given users
    for (let i = 0; i < Object.keys(users).length; i++) {
        const urserId = Object.keys(users)[i];
        const user = userObject[urserId].user_email;

        // Check if the user is found in any team
        if (userTeamMap.has(user)) {
            for (const team of userTeamMap.get(user)) {
                if (team.team_admins.length === 1) {
                    if (!affectedTeams[team.team_id]) {
                        affectedTeams[team.team_id] = {
                            team_id: team.team_id,
                            team_name: team.team_name,
                            conflict_team_admins: [user],
                            conflict_team_admins_ids: [urserId],
                            result: 'Service User has not been added',
                            test_mode: (IS_TEST ? 'Yes' : 'No')
                        };
                    }
                    else {
                        affectedTeams[team.team_id].conflict_team_admins.push(user);
                        affectedTeams[team.team_id].conflict_team_admins_ids.push(urserId);
                    }
                }
            }
        }

        // To avoid freezing the browser, yield control every 100 iterations
        if (i % 100 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    console.log(`Total affected teams: ${Object.keys(affectedTeams).length}`);
    createLogEntry('info',`Total affected teams: ${Object.keys(affectedTeams).length} | function: getAffectedTeams `,true,IS_TEST);
    createLogEntry('info',`Checking affected teams COMPLETE | function: getAffectedTeams `,true,IS_TEST);
}

/* Function to get all Teams in the Miro account */
async function getTeams(orgId, cursor) {
    createLogEntry('info','Getting all Teams in the Miro account | function: getTeams ',true,IS_TEST);
    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + REST_TOKEN
    };

    let reqGetOptions = {
        method: 'GET',
        headers: reqHeaders,
        body: null
    };

    let url = `https://api.miro.com/v2/orgs/${orgId}/teams` + (cursor ? `?cursor=${cursor}` : '');
    console.log('Getting Miro Teams - API URL --> : ' + url);
    createLogEntry('info',`Getting Miro Teams - API URL --> : ${url} | function: getTeams `,true,IS_TEST);
    let listTeams = await callAPI(url, reqGetOptions);
    if (listTeams.status === 200) {
        for(let i=0; i < listTeams.body.data.length; i++) {
            let teamId = listTeams.body.data[i].id;
            teams[teamId] = {
                miro_company_id: orgId,
                team_name: listTeams.body.data[i].name.toString(),
                team_id: teamId.toString(),
                team_admins: []
            };
        }

        if (listTeams.body.cursor) {
            await getTeams(orgId, listTeams.body.cursor);
        }
        else {
            console.log('Getting Miro Teams COMPLETE...');
            createLogEntry('info','Getting Miro Teams COMPLETE | function: getTeams ',true,IS_TEST);
            await getTeamAdmins(numberOfRequests);
            if (Object.keys(getIndividualTeamsErrors).length === 0) {
                createLogEntry('info','Getting Team Admins COMPLETE | function: getTeamAdmins ',true,IS_TEST);
                console.log('Getting Miro Teams Admins COMPLETE...');
                await getAffectedTeams(inactiveUsers, teams);
                console.log('Identifying affected Teams Admins COMPLETE...');
                await inviteServiceAccountAsTeamAdmin(numberOfRequestsForPost);
                console.log('Adding Service User to the affected Teams COMPLETE...');
                console.log(`Has No Errors --> ${Object.keys(getIndividualTeamsErrors).length === 0}`);
                if (Object.keys(getIndividualTeamsErrors).length === 0) {
                    createLogEntry('info','About to deactivate users',true,IS_TEST);
                    console.log('About to deactivate users');
                    await deactivateUsersSCIM(1000);
                }
            }
            addReportsForNodeJS();
            console.log(`Script end time: ${new Date()}`);
            console.log('********** END OF SCRIPT **********\n\n');
            return true;
        }
    }
    if (listTeams.rate_limit_remaining === '0') {
        await holdScriptExecution(61000);
    }
}

function chunckArray(arr, groupCount) {
    return arr.reduce((result, _, index) => {
        if (index % groupCount === 0) {
            result.push(arr.slice(index, index + groupCount).join(','));
        }
        return result;
    }, []);
}

function fixedEncodeURIComponent(str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
        return "%" + c.charCodeAt(0).toString(16);
    });
}

function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    const regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return "";
    //return decodeURIComponent(results[2].replace(/\+/g, " "));
    return results[2];
}

var delay = ms => new Promise(res => setTimeout(res, ms));
var holdScriptExecution = async (ms) => {
    createLogEntry('info','**** Rate limit hit - Delaying execution for ' + (ms/1000) + ' seconds to replenish rate limit credits - Current time: ' + new Date() + '***',true,IS_TEST);
    console.log('**** Rate limit hit - Delaying execution for ' + (ms/1000) + ' seconds to replenish rate limit credits - Current time: ' + new Date() + '***');
    await delay(ms);
    createLogEntry('info','**** Resumming script execution ***',true,IS_TEST);
    console.log('**** Resumming script execution ***');
};

function createCounter() {
    let seconds = 0;
    let intervalId = null;

    // Start the counter
    function startCounter() {
        //counterSection.classList.remove('hide');
        if (intervalId === null) { // Prevent multiple intervals
            intervalId = setInterval(() => {
                seconds++;
                //counterSpan.textContent = seconds;
                console.log(`${seconds} seconds....`);
            }, 1000);
        }
    }

    // Stop the counter
    function stopCounter() {
        if (intervalId !== null) {
            clearInterval(intervalId); // Stop the interval
            intervalId = null; // Reset interval ID
        }
        seconds = 0; // Reset the counter
        //updateCounter(); // Update the display
    }

    // Return the control functions
    return { startCounter, stopCounter };
}

/* Function to get User's Last Activity Date */
async function getUsersLastActivityDate(numberOfCalls) {
    createLogEntry('info','Getting last activity date of all users | function: getUsersLastActivityDate ',true,IS_TEST);
    let encodedEmails = [];

    for(let i=0; i < Object.keys(userObject).length; i++) {
        let userId = Object.keys(userObject)[i];
        let email = userObject[userId].user_email;
        //encodedEmails[i] = fixedEncodeURIComponent(encodedEmails[i]);
        encodedEmails.push(fixedEncodeURIComponent(email));
    }
    
    let chunckedArray = chunckArray(encodedEmails, 10);
    let totalItems;
    let batchUrls;
    let usersInBatch;
    let getProcessedUsers = {}
    let processedUrls = [];
    let batchSize;
    let getRemainingUsers = {};

    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + REST_TOKEN
    };

    let reqGetOptions = {
        method: 'GET',
        headers: reqHeaders,
        body: null
    };

    totalItems = chunckedArray;

    for(let i=0; i < totalItems.length; i++) {
        getRemainingUsers[totalItems[i]] = { usersInBatch: totalItems[i] }
    }

    while (Object.keys(getRemainingUsers).length > 0) {
        createLogEntry('info',`----- Getting User Last Activity Date - Remaining ${Object.keys(getRemainingUsers).length} | function: getUsersLastActivityDate`,true,IS_TEST);
        console.log(`----- Getting User Last Activity Date - Remaining ${Object.keys(getRemainingUsers).length}`);
        let apiUrl = `https://api.miro.com/v2/orgs/${MIRO_COMPANY_ID}/members`;
        
        // Calculate the number of items remaining to fetch
        let remainingItems = totalItems.length - Object.keys(getProcessedUsers).length;

        if (Object.keys(getUsersOrgErrors).length === 0) {

            // Calculate the number of calls to make in this batch
            batchSize = Math.min(numberOfCalls, Math.ceil(remainingItems / 1));
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${apiUrl}?emails=${Object.keys(getRemainingUsers)[index]}`);

        }
        else {
            createLogEntry('info',`Errors found - retrying failed requests | function: getUsersLastActivityDate`,true,IS_TEST);
            console.log('Errors found - retrying failed requests | function: getUsersLastActivityDate');
            await holdScriptExecution(61000);
            batchSize = Object.keys(getUsersOrgErrors).length;
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${Object.keys(getUsersOrgErrors)[index]}`);
            processedUrls.forEach(function(item) {
                let urlIndex = batchUrls.indexOf(item);
                if (urlIndex !== -1) {
                    batchUrls.splice(urlIndex, 1);
                }
            });
            errorRetryCount = errorRetryCount + 1;
            console.log(`errorRetryCount --> ${errorRetryCount}`);
            if (errorRetryCount < 13) {
                if (errorRetryCount === 12) {
                    createLogEntry('info',`This is the 12th and last attempt to retry failed "getUsersLastActivityDate" calls | function: getUsersLastActivityDate`,true,IS_TEST);
                    console.log('This is the 12th and last attempt to retry failed "getUsersLastActivityDate" calls...');
                }
            }
            else {
                createLogEntry('info',`Maximum amount of retry attempts for failed "getUsersLastActivityDate" calls reached (12). Please review the "getUsersOrgErrors" object to find out what the problem is | function: getUsersLastActivityDate`,true,IS_TEST);
                console.log('Maximum amount of retry attempts for failed "getUsersLastActivityDate" calls reached (12). Please review the "getUsersOrgErrors" object to find out what the problem is...');
                return false;
            }
        }
        if (Object.keys(getUsersOrgErrors).length > 0) { 
            createLogEntry('info',`Failed API calls to retry below: ----- | function: getUsersLastActivityDate`,true,IS_TEST);
            console.log(`Failed API calls to retry below: -----`); 
        }
        if (batchUrls.length > 0) {
            createLogEntry('info',`API URLs in this the batch are: ----- | function: getUsersLastActivityDate`,true,IS_TEST);
            console.log(`.........API URLs in this the batch are:`);
            console.table(batchUrls);
            createLogEntry('object',JSON.stringify(batchUrls, null, 2),true,IS_TEST);

            try {       
                const promisesWithUrls = batchUrls.map(url => {
                    const promise = fetch(url, reqGetOptions)
                        .catch(error => {
                            // Check if the error is a response error
                            if (error instanceof Response) {
                                // Capture the HTTP error code and throw it as an error
                                usersInBatch = getParameterByName(emails,url);
                                if (!getUsersOrgErrors[url]) {
                                    getUsersOrgErrors[url] = { url: url, info: `Promise fetch call failed | function: getUsersLastActivityDate | usersInBatch: ${usersInBatch} | errorMessage: ${error.statusText}`, error: error.status };
                                }
                                console.error({ usersInBatch: usersInBatch, url: url, error: error.status, errorMessage: error.statusText });
                                return Promise.reject(error);
                            }
                            else {
                                // For other types of errors, handle them as usual
                                throw error;
                            }
                        });
                    return { promise, url };
                });

                // Fetch data for each URL in the batch
                const batchResponses = await Promise.allSettled(promisesWithUrls.map(({ promise }) => promise));
                for (let i = 0; i < batchResponses.length; i++) {
                    let { status, value, reason } = batchResponses[i];
                    if (status === 'fulfilled') {
                        if (value.ok) {
                            errorRetryCount = 0;
                            if (value.status === 200) {
                                usersInBatch = getParameterByName('emails',value.url);
                                let batchData = await value.json();
                                if (batchData.length > 0) {
                                    for(let a=0; a < batchData.length; a++) {
                                        let userId = batchData[a].id;
                                        let email = batchData[a].email;
                                        let lastActivityDate = (batchData[a]?.lastActivityAt ? batchData[a]?.lastActivityAt : null);
                                        let licenseAssignmentDate = (batchData[a]?.licenseAssignedAt ? batchData[a]?.licenseAssignedAt : null);
                                        userObject[userId].lastActivityDate = lastActivityDate;
                                        userObject[userId].licenseAssignmentDate = licenseAssignmentDate;
                                        if (!inactiveUsers[userId]) {
                                            if (lastActivityDate) {
                                                if (lastActivityDate < lastAcceptedDate) {
                                                    inactiveUsers[userId] = {
                                                        user_id: userId,
                                                        username: email,
                                                        lastActivityDate: (lastActivityDate ? lastActivityDate : ''),
                                                        licenseAssignmentDate: (licenseAssignmentDate ? licenseAssignmentDate : ''),
                                                        test_mode: (IS_TEST ? 'Yes' : 'No')
                                                    }
                                                }
                                            }
                                            else {
                                                let compareDateValue = (licenseAssignmentDate ? licenseAssignmentDate : '1980-01-01T00:00:00Z');
                                                if (compareDateValue < lastAcceptedDate) {
                                                    inactiveUsers[userId] = {
                                                        user_id: userId,
                                                        username: email,
                                                        lastActivityDate: (lastActivityDate ? lastActivityDate : ''),
                                                        licenseAssignmentDate: (licenseAssignmentDate ? licenseAssignmentDate : ''),
                                                        test_mode: (IS_TEST ? 'Yes' : 'No')
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                if (processedUrls.indexOf(value.url) === -1) { processedUrls.push(value.url) };
                                delete getRemainingUsers[usersInBatch];
                                getProcessedUsers[usersInBatch] = { usersInBatch: usersInBatch };
                                if (getUsersOrgErrors[value.url]) {
                                    delete getUsersOrgErrors[value.url];
                                }
                                createLogEntry('info',`Processed user groups: ${Object.keys(getProcessedUsers).length} out of ${totalItems.length} | function: getUsersLastActivityDate`,true,IS_TEST);
                                console.log(`Processed user groups: ${Object.keys(getProcessedUsers).length} out of ${totalItems.length}`);
                            }
                        }
                        else {
                            usersInBatch = getParameterByName('emails',value.url);
                            if (!getUsersOrgErrors[value.url]) {
                                getUsersOrgErrors[value.url] = { url: value.url, info: `API call error | function: getUsersLastActivityDate | usersInBatch: ${usersInBatch}`, error: value.status };
                            }
                        }
                    }
                    else {
                        let index = batchResponses.indexOf({ status, value, reason });
                        let failedUrl = promisesWithUrls[index].url;
                        usersInBatch = getParameterByName(emails,failedUrl);
                        if (!getUsersOrgErrors[failedUrl]) {
                            getUsersOrgErrors[failedUrl] = { url: failedUrl, info: `Promise fetch call failed | function: getUsersLastActivityDate | usersInBatch: ${usersInBatch}`, error: value.status };
                        }
                        createLogEntry('info',`Promise fetch call failed | function: getUsersLastActivityDate | usersInBatch: ${usersInBatch} | function: getUsersLastActivityDate | error: ${value.status}`,true,IS_TEST);
                        console.error(`Promise fetch call failed - API URL --> ${failedUrl}:`, reason);
                    }
                }

            } catch (error) {
                console.error(error);
            }
        }
    }
    if (Object.keys(getUsersOrgErrors).length === 0) {
        createLogEntry('info','Getting last activity date of all users COMPLETE | function: getUsersLastActivityDate ',true,IS_TEST);
        await getTeams(MIRO_COMPANY_ID);
    }
}

async function deactivateUsersSCIM(numberOfSCIMRequests) {
    createLogEntry('info','Deactivating inactive users | function: deactivateUsersSCIM ',true,IS_TEST);
    console.log('Deactivating inactive users | function: deactivateUsersSCIM');
    if (IS_TEST) {
        createLogEntry('info','Deactivating inactive users skipped (TEST MODE is ON)| function: deactivateUsersSCIM ',true,IS_TEST);
        console.log('Deactivating inactive users skipped (TEST MODE is ON)| function: deactivateUsersSCIM');
        return false;
    }
    debugger;
    const results = [];
    let processedUrls = [];
    let globalProcessedUrls = {};
    let batchUrls;
    let initialData;
    let totalItems;
    let boardsArray;
    let processedItems;
    let apiUrl = `https://miro.com/api/v1/scim/Users`;

    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SCIM_TOKEN
    };

    let payload = JSON.stringify({
      "schemas": [
        "urn:ietf:params:scim:api:messages:2.0:PatchOp"
      ],
      "Operations": [
        {
          "op": "Replace",
          "path": "active",
          "value": false
        }
      ]
    });

    let reqGetOptions = {
        method: 'PATCH',
        headers: reqHeaders,
        body: payload
    };

    console.log(`Deactivating users via SCIM | API URL --> ${apiUrl}`);
    createLogEntry('info',`Deactivating users via SCIM | API URL --> ${apiUrl}`,false,IS_TEST);

    totalItems = Object.keys(inactiveUsers).length;
    processedItems = 0;
    
    while (processedItems < totalItems) {
        debugger;
        console.log(`Deactivated users | SCIM | --> ${processedItems} out of ${totalItems}`);
        createLogEntry('info',`Deactivated users | SCIM | --> ${processedItems} out of ${totalItems}`,false,IS_TEST);

        console.log(`....Deactivating further users in batches of max 1000 per batch`);
        createLogEntry('info',`....Deactivating further users in batches of max 1000 per batch`,false,IS_TEST);
        
        // Calculate the number of items remaining to fetch
        const remainingItems = totalItems - processedItems;
        // Calculate the number of calls to make in this batch (up to 4)
        const batchSize = Math.min(numberOfSCIMRequests, Math.ceil(remainingItems / 1));

        // Generate URLs for the next batch of calls
        if (Object.keys(deactivateUsersSCIMErrors).length > 0) {
            if (deactivateUsersSCIMErrors[Object.keys(deactivateUsersSCIMErrors)[Object.keys(deactivateUsersSCIMErrors).length - 1]].error == 429) { 
                let counter = createCounter();
                counter.startCounter();
                await holdScriptExecution(39000);
                counter.stopCounter();
                console.log('Resuming script....');
            }
            // else if (getBoardsErrors[Object.keys(getBoardsErrors)[Object.keys(getBoardsErrors).length - 1]].error == 401) {
            //     await refreshData();
            //     reqHeaders['Authorization'] = 'Bearer ' + data_id;
            // }
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${Object.keys(deactivateUsersSCIMErrors)[index]}`);
            processedUrls.forEach(function(item) {
                let urlIndex = batchUrls.indexOf(item);
                if (urlIndex !== -1) {
                    batchUrls.splice(urlIndex, 1);
                }
            });
            batchUrls.forEach(function(item) {
                if (item === 'undefined') {
                    batchUrls.splice(item, 1);
                }
            });
            errorRetryCount = errorRetryCount + 1;
            if (errorRetryCount < 8) {
                if (errorRetryCount === 7) { 
                    console.log('This is the seventh and last attempt to retry failed "deactivateUsersSCIM" calls...');
                    createLogEntry('info','This is the seventh and last attempt to retry failed "deactivateUsersSCIM" calls...',false,IS_TEST);
                }
            }
            else {
                console.log('Maximum amount of retry attempts for failed "getBoards" calls reached (7). Please review the "deactivateUsersSCIM" object to find out what the problem is...');
                createLogEntry('info','This is the seventh and last attempt to retry failed "deactivateUsersSCIM" calls...',false,IS_TEST);
                return false;
            }
        }
        else {
            //apiUrl = `https://miro.com/api/v1/scim/Users?attributes=userName&filter=(active eq true)`;
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${apiUrl}/${Object.keys(inactiveUsers)[index]}`);
        }
        console.log(`.........API URLs for the batch are:`);
        createLogEntry('info',`.........API URLs for the batch are:`,false,IS_TEST);
        
        console.table(batchUrls);
        createLogEntry('object',JSON.stringify(batchUrls, null, 2),true,IS_TEST);

        try {
            const promisesWithUrls = batchUrls.map(url => {
                const promise = fetch(url, reqGetOptions)
                .catch(error => {
                    let errorMessage = { url: url, errorCode: (error?.status || 'rejected'), errorMessage: error, errorExplanation: 'possibly (failed)net::ERR_INSUFFICIENT_RESOURCES or (failed)net::ERR_CONNECTION_CLOSED' };
                    if (!deactivateUsersSCIMErrors[url]) {
                        deactivateUsersSCIMErrors[url] = { url: url, info: `Promise fetch call failed | function: deactivateUsersSCIM | errorMessage: ${error} | errorExplanation: possibly (failed)net::ERR_INSUFFICIENT_RESOURCES or (failed)net::ERR_CONNECTION_CLOSED`, error: (error?.status || 'rejected') };
                    }
                    //console.error(errorMessage);
                    return Promise.reject(errorMessage);
                });
                return { promise, url };
            });

            // Fetch data for each URL in the batch
            const batchResponses = await Promise.allSettled(promisesWithUrls.map(({ promise }) => promise));
            for (let i = 0; i < batchResponses.length; i++) {
                let { status, value, reason } = batchResponses[i];
                let userId = value.url.split('/');
                userId = userId[7];
                if (status === 'fulfilled') {
                    if (!value.ok) {
                        if (!deactivateUsersSCIMErrors[value.url]) {
                            deactivateUsersSCIMErrors[value.url] = { url: value.url, info: `API call error | function: deactivateUsersSCIM | user_id: ${userId}`, error: value?.status };
                        }
                    }
                    else {
                        errorRetryCount = 0;
                        if (processedUrls.indexOf(value.url) === -1) {
                            let batchData = await value.json();
                            processedUrls.push(value.url); 
                            userObject[userId].result = 'deactivation successul';
                            processedItems = processedItems + 1;

                            if (deactivateUsersSCIMErrors[value.url]) {
                                delete deactivateUsersSCIMErrors[value.url];
                            }
                            if (!globalProcessedUrls[value.url]) {
                                globalProcessedUrls[value.url] = { requestStatus: 'valid response received' };
                            }
                        }
                        console.log(`Deactivated users: ${processedItems} out of ${totalItems}`);
                        createLogEntry('info',`Deactivated users: ${processedItems} out of ${totalItems}`,true,IS_TEST);
                    }
                }
                else {
                    let failedUrl = promisesWithUrls[i].url;
                    if (!deactivateUsersSCIMErrors[failedUrl]) {
                        deactivateUsersSCIMErrors[failedUrl] = { url: failedUrl, info: `Promise fetch call failed | function: deactivateUsersSCIM | user_id: ${userId} | errorMessage: ${reason?.errorMessage} | errorExplanation: ${reason?.errorExplanation}`, error: 'promise_failed' };
                    }
                    let errorDetails = `action: deactivateUsersSCIMErrors | url: ${failedUrl} errorCode: ${reason?.errorExplanation} | errorMessage: ${reason?.errorMessage}`;
                    let reason = `Reason: ${reason.errorExplanation} | Reported error: ${reason.errorMessage} | Next step: Error added to array of errors. Request will be retried automatically`;
                    console.error(`deactivateUsersSCIMErrors | Promise rejected - API URL: ${failedUrl}:`, reason);
                    createLogEntry('error',`deactivateUsersSCIMErrors | Promise rejected - API URL --> ${failedUrl}: ${reason}`,true,IS_TEST);
                }
            }
        }
        catch (error) {
            createLogEntry('error','deactivateUsersSCIMErrors | Fetch error. See below:',true,IS_TEST);
            createLogEntry('error',error,true,IS_TEST);
            createLogEntry('object',JSON.stringify(error, null, 2),true,IS_TEST);
            console.error(error);
        }
        if (Object.keys(deactivateUsersSCIMErrors).length === 0) {
            createLogEntry('info','Deactivating inactive users COMPLETE | function: deactivateUsersSCIM ',true,IS_TEST);
        }
    }
}

async function getUsersSCIM(numberOfSCIMRequests) {
    createLogEntry('info','Getting all users in the Miro account | function: getUsersSCIM ',true,IS_TEST);
    const results = [];
    let processedUrls = [];
    let globalProcessedUrls = {};
    let batchUrls;
    let initialData;
    let totalItems;
    let boardsArray;
    let processedItems;
    let apiUrl = `https://miro.com/api/v1/scim/Users?count=0&filter=(active eq true)`;

    let reqHeaders = {
        'cache-control': 'no-cache, no-store',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SCIM_TOKEN
    };

    let reqGetOptions = {
        method: 'GET',
        headers: reqHeaders,
        body: null
    };

    try {
        var response = await fetch(apiUrl, reqGetOptions);
        if (!response.ok) {
            throw new Error(`Failed to fetch data from ${apiUrl}: ${response.status} ${response.statusText}`);
        }
        else {
            processedUrls.push(apiUrl);
            if (!globalProcessedUrls[apiUrl]) {
                globalProcessedUrls[apiUrl] = { requestStatus: 'valid response received' };
            }
            if (getUsersSCIMErrors[apiUrl]) {
                delete getUsersSCIMErrors[apiUrl];
            }
        }
    } 
    catch (error) {
        createLogEntry('error','Fetch error. See below:',true,IS_TEST);
        createLogEntry('error',error,true,IS_TEST);
        createLogEntry('object',JSON.stringify(error, null, 2),true,IS_TEST);
        console.error(error);
        if (!getUsersSCIMErrors[apiUrl]) {
            getUsersSCIMErrors[apiUrl] = { url: apiUrl, info: `error: ${error}`, error: error };
        }
        if (Object.keys(getUsersSCIMErrors).length > 0) {
            if (getUsersSCIMErrors[Object.keys(getUsersSCIMErrors)[Object.keys(getUsersSCIMErrors).length - 1]].error == 429) { 
				let counter = createCounter();
				counter.startCounter();
			    await holdScriptExecution(39000);
			    counter.stopCounter();
			    console.log('Resuming script....');
            }
            // else if (getBoardsErrors[Object.keys(getBoardsErrors)[Object.keys(getBoardsErrors).length - 1]].error == 401) {
            //     await refreshData();
            //     reqHeaders['Authorization'] = 'Bearer ' + window.migApp.current;
            // }
        }
        return await getUsersSCIM(numberOfSCIMRequests, SCIM_TOKEN);
    }

    console.log(`Getting users via SCIM | API URL --> ${apiUrl}`);
    createLogEntry('info',`Getting users via SCIM | API URL --> ${apiUrl}`,false,IS_TEST);

    initialData = await response.json();
    totalItems = initialData.totalResults;
    processedItems = 0;
    
    while (processedItems < totalItems) {
        console.log(`Received users | SCIM | --> ${processedItems} out of ${totalItems}`);
        createLogEntry('info',`Received users | SCIM | --> ${processedItems} out of ${totalItems}`,false,IS_TEST);

        console.log(`....Getting further users in batches of max 1000 per batch`);
        createLogEntry('info',`....Getting further users in batches of max 1000 per batch`,false,IS_TEST);
        
        // Calculate the number of items remaining to fetch
        const remainingItems = totalItems - processedItems;
        // Calculate the number of calls to make in this batch (up to 4)
        const batchSize = Math.min(numberOfSCIMRequests, Math.ceil(remainingItems / 1000));

        // Generate URLs for the next batch of calls
        if (Object.keys(getUsersSCIMErrors).length > 0) {
            if (getUsersSCIMErrors[Object.keys(getUsersSCIMErrors)[Object.keys(getUsersSCIMErrors).length - 1]].error == 429) { 
				let counter = createCounter();
				counter.startCounter();
			    await holdScriptExecution(39000);
			    counter.stopCounter();
			    console.log('Resuming script....');
            }
            // else if (getBoardsErrors[Object.keys(getBoardsErrors)[Object.keys(getBoardsErrors).length - 1]].error == 401) {
            //     await refreshData();
            //     reqHeaders['Authorization'] = 'Bearer ' + data_id;
            // }
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${Object.keys(getUsersSCIMErrors)[index]}`);
            processedUrls.forEach(function(item) {
                let urlIndex = batchUrls.indexOf(item);
                if (urlIndex !== -1) {
                    batchUrls.splice(urlIndex, 1);
                }
            });
            batchUrls.forEach(function(item) {
                if (item === 'undefined') {
                    batchUrls.splice(item, 1);
                }
            });
            errorRetryCount = errorRetryCount + 1;
            if (errorRetryCount < 8) {
                if (errorRetryCount === 7) { 
                    console.log('This is the seventh and last attempt to retry failed "getUsers" calls...');
                    createLogEntry('info','This is the seventh and last attempt to retry failed "getUsers" calls...',false,IS_TEST);
                }
            }
            else {
                console.log('Maximum amount of retry attempts for failed "getBoards" calls reached (7). Please review the "getBoards" object to find out what the problem is...');
                createLogEntry('info','This is the seventh and last attempt to retry failed "getBoards" calls...',false,IS_TEST);
                return false;
            }
        }
        else {
            apiUrl = `https://miro.com/api/v1/scim/Users?attributes=userName&filter=(active eq true)`;
            batchUrls = Array.from({ length: batchSize }, (_, index) => `${apiUrl}&count=1000&startIndex=${processedItems + index * 1000}`);
        }
        console.log(`.........API URLs for the batch are:`);
        createLogEntry('info',`.........API URLs for the batch are:`,false,IS_TEST);
        
        console.table(batchUrls);
        createLogEntry('object',JSON.stringify(batchUrls, null, 2),true,IS_TEST);

        try {
            // Create an array to store promises along with their corresponding URLs
            // const promisesWithUrls = batchUrls.map(url => {
            //     const promise = fetch(url, reqGetOptions).catch(error => {
            //         if (!getBoardsErrors[url]) {
            //             getBoardsErrors[url] = {team: teamId, url: url, error: error};
            //         }
            //         createLogEntry('error','Fetch error. See below:',true,IS_TEST);
            //         createLogEntry('object',JSON.stringify({team: teamId, url: url, errorMessage: error}, null, 2),true,IS_TEST);
            //         console.error({team: teamId, url: url, errorMessage: error});
            //         return Promise.reject(error);
            //     });
            //     return { promise, url };
            // });

            const promisesWithUrls = batchUrls.map(url => {
                const promise = fetch(url, reqGetOptions)
                .catch(error => {
                    let errorMessage = { url: url, errorCode: (error?.status || 'rejected'), errorMessage: error, errorExplanation: 'possibly (failed)net::ERR_INSUFFICIENT_RESOURCES or (failed)net::ERR_CONNECTION_CLOSED' };
                    if (!getUsersSCIMErrors[url]) {
                        getUsersSCIMErrors[url] = { url: url, info: `Promise fetch call failed | function: getUsersSCIM | errorMessage: ${error} | errorExplanation: possibly (failed)net::ERR_INSUFFICIENT_RESOURCES or (failed)net::ERR_CONNECTION_CLOSED`, error: `${(error?.status || 'rejected')}` };
                    }
                    //console.error(errorMessage);
                    return Promise.reject(errorMessage);
                });
                return { promise, url };
            });

            // Fetch data for each URL in the batch
            const batchResponses = await Promise.allSettled(promisesWithUrls.map(({ promise }) => promise));
            for (let i = 0; i < batchResponses.length; i++) {
                let { status, value, reason } = batchResponses[i];
                if (status === 'fulfilled') {
                    if (!value.ok) {
                        if (!getUsersSCIMErrors[value.url]) {
                            getUsersSCIMErrors[value.url] = { url: value.url, info: 'API call error | function: getUsersSCIM', error: value?.status };
                        }
                    }
                    else {
                        errorRetryCount = 0;
                        if (processedUrls.indexOf(value.url) === -1) {
                            let batchData = await value.json();
                            processedUrls.push(value.url); 

                            for(let i=0; i < batchData.Resources.length; i++) {
                                let userId = batchData.Resources[i].id;
                                if (!userObject[userId]) {
                                    userObject[userId] = {
                                        user_id: userId,
                                        user_email: batchData.Resources[i].userName,
                                        result: 'active'
                                    };
                                    if (batchData.Resources[i].userName === SERVICE_ACCOUNT_EMAIL) {
                                        SERVICE_ACCOUNT_ID = userId;
                                    }
                                    processedItems = processedItems + 1;
                                }
                            }

                            if (getUsersSCIMErrors[value.url]) {
                                delete getUsersSCIMErrors[value.url];
                            }
                            if (!globalProcessedUrls[value.url]) {
                                globalProcessedUrls[value.url] = { requestStatus: 'valid response received' };
                            }
                        }
                        console.log(`Received users: ${processedItems} out of ${totalItems}`);
                        createLogEntry('info',`Received users: ${processedItems} out of ${totalItems}`,true,IS_TEST);
                    }
                }
                else {
                    let failedUrl = promisesWithUrls[i].url;
                    if (!getUsersSCIMErrors[failedUrl]) {
                        getUsersSCIMErrors[failedUrl] = { url: failedUrl, info: `Promise fetch call failed | function: getUsersSCIM | errorCode: 'promise_failed' | errorMessage: ${reason?.errorMessage} | errorExplanation: ${reason?.errorExplanation} | errorMessage: ${reason?.errorMessage}`, error: 'promise_failed' };
                    }
                    let errorDetails = `action: getUsersSCIMErrors | url: ${failedUrl} errorCode: ${reason?.errorExplanation} | errorMessage: ${reason?.errorMessage}`;
                    let reason = `Reason: ${reason.errorExplanation} | Reported error: ${reason.errorMessage} | Next step: Error added to array of errors. Request will be retried automatically`;
                    console.error(`getUsersSCIMErrors | Promise rejected - API URL: ${failedUrl}:`, reason);
                    createLogEntry('error',`getUsersSCIMErrors | Promise rejected - API URL --> ${failedUrl}: ${reason}`,true,IS_TEST);
                }
            }
        }
        catch (error) {
            createLogEntry('error','getUsersSCIMErrors | Fetch error. See below:',true,IS_TEST);
            createLogEntry('error',error,true,IS_TEST);
            createLogEntry('object',JSON.stringify(error, null, 2),true,IS_TEST);
            console.error(error);
        }
    }

    if (Object.keys(getUsersSCIMErrors).length === 0) {
        createLogEntry('info','Getting all users in the Miro account COMPLETE | function: getUsersSCIM ',true,IS_TEST);
        await getUsersLastActivityDate(52);
    }
}

getUsersSCIM(5);

