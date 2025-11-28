import unittest

from flask import json

from inorch_tmf_proxy.models.error import Error  # noqa: E501
from inorch_tmf_proxy.models.intent import Intent  # noqa: E501
from inorch_tmf_proxy.models.intent_fvo import IntentFVO  # noqa: E501
from inorch_tmf_proxy.models.intent_mvo import IntentMVO  # noqa: E501
from inorch_tmf_proxy.test import BaseTestCase


class TestIntentController(BaseTestCase):
    """IntentController integration test stubs"""

    def test_create_intent(self):
        """Test case for create_intent

        Creates an Intent
        """
        intent_fvo = inorch_tmf_proxy.IntentFVO()
        query_string = [('fields', 'fields_example')]
        headers = { 
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        }
        response = self.client.open(
            '/intentManagement/intent',
            method='POST',
            headers=headers,
            data=json.dumps(intent_fvo),
            content_type='application/json',
            query_string=query_string)
        self.assert200(response,
                       'Response body is : ' + response.data.decode('utf-8'))

    def test_delete_intent(self):
        """Test case for delete_intent

        Deletes an Intent
        """
        headers = { 
            'Accept': 'application/json',
        }
        response = self.client.open(
            '/intentManagement/intent/{id}'.format(id='id_example'),
            method='DELETE',
            headers=headers)
        self.assert200(response,
                       'Response body is : ' + response.data.decode('utf-8'))

    def test_list_intent(self):
        """Test case for list_intent

        List or find Intent objects
        """
        query_string = [('fields', 'fields_example'),
                        ('offset', 56),
                        ('limit', 56)]
        headers = { 
            'Accept': 'application/json',
        }
        response = self.client.open(
            '/intentManagement/intent',
            method='GET',
            headers=headers,
            query_string=query_string)
        self.assert200(response,
                       'Response body is : ' + response.data.decode('utf-8'))

    def test_patch_intent(self):
        """Test case for patch_intent

        Updates partially an Intent
        """
        intent_mvo = inorch_tmf_proxy.IntentMVO()
        query_string = [('fields', 'fields_example')]
        headers = { 
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        }
        response = self.client.open(
            '/intentManagement/intent/{id}'.format(id='id_example'),
            method='PATCH',
            headers=headers,
            data=json.dumps(intent_mvo),
            content_type='application/json',
            query_string=query_string)
        self.assert200(response,
                       'Response body is : ' + response.data.decode('utf-8'))

    def test_retrieve_intent(self):
        """Test case for retrieve_intent

        Retrieves an Intent by ID
        """
        query_string = [('fields', 'fields_example')]
        headers = { 
            'Accept': 'application/json',
        }
        response = self.client.open(
            '/intentManagement/intent/{id}'.format(id='id_example'),
            method='GET',
            headers=headers,
            query_string=query_string)
        self.assert200(response,
                       'Response body is : ' + response.data.decode('utf-8'))


if __name__ == '__main__':
    unittest.main()
