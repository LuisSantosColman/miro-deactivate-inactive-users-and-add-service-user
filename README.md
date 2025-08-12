# Miro - Deactivate Inactive Users and Add Service User to Teams (Node.js)

This repository contains a script in JavaScript/Node.js to identify inactive users and deactivate them using Miro's SCIM and REST API.

The script provides a __TEST MODE__ flag to run it without performing any changes. (See __step 5__ further below).

## Disclaimer
The content of this project is subject to the Miro Developer Terms of Use: https://miro.com/legal/developer-terms-of-use/<br>
This script is provided as an example to illustrate how to identify Miro Teams with no Boards within and to remove these empty Teams.
The usage of this script is at the sole discretion and responsibility of the customer and is to be tested thoroughly before running it on Production environments.

## Requirements

* [NodeJS 16.x or higher installed](https://nodejs.org/en/download/)
* You must be a __Company Admin__ in your Miro account, or at least the user generating the token must be a __Company Admin__ in your Miro account (see steps 3 to 5)

__Note__: If the person running the script is not a __Miro Company Admin__ in your organization's Miro account, please have a __Miro Company Admin__ in your Miro account follow the __steps 3 to 5__. Once the token has been created, the Miro __Company Admin__ with the __Content Admin__ role can provide the token to the user who will run the scripts to execute the changes.

## Step 1. Install Node.js

1.1. If you already have Node.js installed in your local machine, you may skip this step.

1.2. If you do not have Node.js installed, proceed to download it [here](https://nodejs.org/en/download/) and proceed to install Node with the downloaded file. (Feel free to use the command line to download and install Node if preferred).

## Step 2. Create directory for your script files

2.1. In your local machine create a folder in the desired location where you will store the files within this repository.

2.2. Download this repository as .zip and extract the files within into the directory created, or clone this repository into the desired location in your local machine. You may also clone this repository via command line.

## Step 3. Create a Developer Team in Miro

3.1. If you already have a Miro Developer Team, you may skip this step.

3.2. If you do not have yet a Miro Developer Team, please visit this [Miro Help](https://help.miro.com/hc/en-us/articles/4766759572114-Enterprise-Developer-teams) page and follow the instructions within the article to create an Enterprise Developer Team for your Miro Enterprise Account.

## Step 4. Create a Miro App to get a REST API Token

4.1. To create a new application on your Miro Enterprise account using the Enterprise Developer team, navigate to __[Profile settings](https://help.miro.com/hc/en-us/articles/4408879513874-Profile-settings) > Your apps__, agree to the terms and conditions, and click on __+ Create new app__.

<img src="https://miro-org.s3.eu-central-1.amazonaws.com/board_classification/Create_new_app.png" alt="Accept app terms screenshot" width="502" />

4.2. Insert the desired app name (e.g. __Deactivate Inactive Users__), select your Developer team for the application and click on __Create app__.

<img src="https://miro-org.s3.eu-central-1.amazonaws.com/board_classification/delete-empty-teams-create-app.jpeg" alt="Create app screenshot" width="502" />

4.3. On the app page, scroll down and select the following scopes of access to grant to your REST API token:<br><br>
  `organizations:read`<br>
  `organizations:teams:read`<br>
  `organizations:teams:write`<br>

<img src="https://miro-org.s3.eu-central-1.amazonaws.com/board_classification/Deactivate_Users_And_Add_Service_User_Scopes.png" alt="API token scopes" width="700" />

4.4. Click on __Install app and get OAuth token__

<img src="https://miro-org.s3.eu-central-1.amazonaws.com/board_classification/install_and_get_token_screenshot1.png" alt="Install and and get token screenshot" width="700" />

4.5. Select any Production team within your Enteprise account, the token will apply for the entire account based on the scopes set on step 5.3 and click on __Add__

<img src="https://miro-org.s3.eu-central-1.amazonaws.com/board_classification/select_team_screenshot.png" alt="Install and and get token screenshot" width="502" />

4.6. You will see the __REST API token__. Copy this token and store it in a secure place. You will need to add it to the script.

<img src="https://miro-org.s3.eu-central-1.amazonaws.com/board_classification/get_access_token_screenshot.png" alt="Install and and get token screenshot" width="502" />

4.7. Find your __Miro Organization ID__ as you will need to add it to the script. You will find your __Miro Organization ID__ in the URL of the page where you received the REST API token

<img src="https://miro-org.s3.eu-central-1.amazonaws.com/board_classification/get_miro_org_id_screenshot.png" alt="Install and and get token screenshot" width="903" />

4.8. Find your __SCIM token__. You will find this token under __Apps and Integrations > Enterprise Integrations__. Copy this token and store it in a secure place. You will need to add it to the script.

<img src="https://miro-org.s3.eu-central-1.amazonaws.com/board_classification/SCIM_Token.png" alt="Install and and get token screenshot" width="903" />

## Step 5. Run script `deactivateInactiveUsers.js` using the command line (CLI)

5.1. Go to the directory where you have saved the file `deactivateInactiveUsers.js`.

5.2. Within the file `deactivateInactiveUsers.js` replace the values of the below variables at the top of the script:

  - `IS_TEST`: Code Line `10` | Set to `true` to run the script in test mode (no changes will occur, only reports will be generated). Set to `false` to perform the needed changes to deactivate inactive users.
  - `MIRO_COMPANY_ID`: Code Line `11` | Replace value with your Miro Organization ID from step 5.7
  - `SCIM_TOKEN`: Code Line `12` | Replace value with your Miro SCIM token from step 5.8
  - `REST_TOKEN`: Code Line `13` | Replace value with your Miro REST API token from step 5.6
  - `SERVICE_ACCOUNT_EMAIL`: Code Line `14` | Replace value with the E-Mail address of your Service Account
  - `DAYS_OF_INACTIVITY`: Code Line `15` | Replace value with number of days a user must be inactive to be eligible for deactivation. Add the number of days as a number/integer (not as a string).

5.2. Save your changes on `deactivateInactiveUsers.js`.

5.3. In your command line interface navigate to the directory where you have placed the script files (see step 2.2) 

5.4. In your command line interface run `node deactivateInactiveUsers.js`. This command will trigger the script.

5.5. Allow the script to finish.

5.6. Within the same folder where this script lives, the script creates a folder called `miro_deactivate_inactive_users_{current_date}`. Within this folder you will find the below reports:

  - `Inactive_Users_Results.csv`: Contains the results of the users to deactivate (if TEST_MODE was on) or that were deactivated (if TEST_MODE was off) in a .CSV file.
  - `Affected_Teams_that_required_Service_User.csv`: Contains the results of the addition of the Service User to the Teams where the last Team Admin was to be deactivated.
  - `Script_Logs.txt`: Contains a log of operations performed by the script (for tracing in case of issues).
  - `Errors.csv`: Contains API errors (if any) in a CSV file. This report is created only if errors occurred, otherwise the file will not be present.

## Support

If you have any questions or need assistance setting up this application, please reach out to your Miro Customer Success Manager, Onboarding Consultant, Technical Architect or dedicated Miro Solutions Engineer.
